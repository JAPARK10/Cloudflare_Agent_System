/**
 * Cloudflare Access JWT verification middleware.
 *
 * When CLOUDFLARE_TEAM_DOMAIN + CLOUDFLARE_ACCESS_AUD are set in the Worker
 * environment, every request must carry a valid `Cf-Access-Jwt-Assertion`
 * header.  Cloudflare Access injects this automatically when the user is
 * logged-in via a CF Zero Trust Access Application policy — the browser
 * does NOT need to send it manually.
 *
 * How to set up:
 *   1. In CF dashboard: Zero Trust → Access → Applications → Add application
 *   2. Policy: allow your email / GitHub / Google account
 *   3. Copy the "Application Audience (AUD) Tag"
 *   4. Set CLOUDFLARE_ACCESS_AUD and CLOUDFLARE_TEAM_DOMAIN as Worker secrets:
 *        wrangler secret put CLOUDFLARE_ACCESS_AUD
 *        wrangler secret put CLOUDFLARE_TEAM_DOMAIN
 *
 * If the env vars are absent the function always returns { authorized: true }
 * so dev mode (wrangler dev) works without CF Access configured.
 */

interface JWTHeader {
    alg: string;
    kid: string;
}

interface JWTPayload {
    aud: string | string[];
    exp: number;
    iat: number;
    email?: string;
    sub?: string;
}

// Module-level key cache — survives Worker isolate lifetime (warm requests)
const KEY_CACHE = new Map<string, CryptoKey>();

function b64UrlDecode(b64url: string): string {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    return atob(b64.padEnd(b64.length + (4 - (b64.length % 4)) % 4, '='));
}

function b64UrlToBytes(b64url: string): Uint8Array<ArrayBuffer> {
    const decoded = b64UrlDecode(b64url);
    const bytes = new Uint8Array(decoded.length);
    for (let i = 0; i < decoded.length; i++) {
        bytes[i] = decoded.charCodeAt(i);
    }
    return bytes;
}

async function fetchPublicKeys(teamDomain: string): Promise<void> {
    const url = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
    // Cache the JWKS response at the CF edge for 1 hour to avoid latency on
    // every request.  Workers' fetch cache is keyed by URL automatically.
    const res = await fetch(url, {
        cf: { cacheEverything: true, cacheTtl: 3600 },
    } as RequestInit);

    if (!res.ok) {
        throw new Error(`Failed to fetch CF Access certs (HTTP ${res.status})`);
    }

    const jwks = await res.json() as { keys: Record<string, unknown>[] };

    for (const jwk of jwks.keys) {
        const kid = String(jwk.kid);
        const cacheKey = `${teamDomain}:${kid}`;

        // Skip if already imported
        if (KEY_CACHE.has(cacheKey)) continue;

        const importAlg =
            jwk.alg === 'RS256'
                ? { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' } as const
                : { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;

        const key = await crypto.subtle.importKey(
            'jwk', jwk as JsonWebKey, importAlg, false, ['verify'],
        );
        KEY_CACHE.set(cacheKey, key);
    }
}

/**
 * Returns true when the `Cf-Access-Jwt-Assertion` request header carries a
 * correctly-signed JWT with the expected audience.
 *
 * Fully self-contained — no external library needed.
 */
export async function verifyCloudflareAccess(
    request: Request,
    teamDomain: string,
    aud: string,
): Promise<{ authorized: boolean; email?: string }> {
    const jwt = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!jwt) return { authorized: false };

    const parts = jwt.split('.');
    if (parts.length !== 3) return { authorized: false };

    const [headerB64, payloadB64, sigB64] = parts;

    let header: JWTHeader;
    let payload: JWTPayload;
    try {
        header  = JSON.parse(b64UrlDecode(headerB64));
        payload = JSON.parse(b64UrlDecode(payloadB64));
    } catch {
        return { authorized: false };
    }

    // ── 1. Expiry ───────────────────────────────────────────────────────────
    if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) {
        return { authorized: false };
    }

    // ── 2. Audience ─────────────────────────────────────────────────────────
    const audList = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
    if (!audList.includes(aud)) {
        return { authorized: false };
    }

    // ── 3. Signature ────────────────────────────────────────────────────────
    const cacheKey = `${teamDomain}:${header.kid}`;

    if (!KEY_CACHE.has(cacheKey)) {
        try {
            await fetchPublicKeys(teamDomain);
        } catch (e) {
            console.error('CF Access cert fetch failed:', e);
            return { authorized: false };
        }
    }

    const pubKey = KEY_CACHE.get(cacheKey);
    if (!pubKey) return { authorized: false }; // unknown kid

    try {
        const signingInput = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
        const signature    = b64UrlToBytes(sigB64);

        const verifyAlg: AlgorithmIdentifier | EcdsaParams =
            header.alg === 'RS256'
                ? { name: 'RSASSA-PKCS1-v1_5' }
                : { name: 'ECDSA', hash: 'SHA-256' };

        const valid = await crypto.subtle.verify(verifyAlg, pubKey, signature, signingInput);
        if (!valid) return { authorized: false };

        return { authorized: true, email: payload.email ?? payload.sub };
    } catch {
        return { authorized: false };
    }
}
