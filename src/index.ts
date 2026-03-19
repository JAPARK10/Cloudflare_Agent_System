import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CerebroAgent } from './agents/ResearchAgent';
import { DeepDiveWorkflow } from './workflows/DeepDiveWorkflow';
import { RateLimiter } from './utils/RateLimiter';
import { verifyCloudflareAccess } from './middleware/auth';

// ── Environment bindings ────────────────────────────────────────────────────
type AppEnv = {
    RESEARCH_AGENT: DurableObjectNamespace;
    DEEPDIVE_WORKFLOW: any; // Cloudflare Workflow binding
    RATE_LIMITER: DurableObjectNamespace;
    AI: any;
    VECTORIZE: VectorizeIndex;
    // ── Security config (set via wrangler.toml [vars] or `wrangler secret put`)
    /** Comma-separated allowed CORS origins.
     *  Example: "https://cerebro-ai.workers.dev,http://localhost:5173" */
    ALLOWED_ORIGINS?: string;
    /** Your Cloudflare Zero Trust team name (the subdomain before .cloudflareaccess.com).
     *  Leave unset to disable CF Access verification in dev. */
    CLOUDFLARE_TEAM_DOMAIN?: string;
    /** AUD tag from your CF Access Application.
     *  Leave unset to disable CF Access verification in dev. */
    CLOUDFLARE_ACCESS_AUD?: string;
};

// ── Request size guards ─────────────────────────────────────────────────────
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10 MB — audio uploads
const MAX_JSON_BYTES  = 32 * 1024;         // 32 KB — all JSON bodies

// ── Project ID allow-list: alphanumeric, dash, underscore, 1–100 chars ──────
const SAFE_ID_RE = /^[\w-]{1,100}$/;
function validId(id: string): boolean {
    return SAFE_ID_RE.test(id);
}

const app = new Hono<{ Bindings: AppEnv }>();

// ════════════════════════════════════════════════════════════════════════════
//  MIDDLEWARE — applied in order: headers → CORS → auth → rate-limit
// ════════════════════════════════════════════════════════════════════════════

// ── 1. Security response headers ────────────────────────────────────────────
app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('X-Frame-Options', 'DENY');
    c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    c.header('Permissions-Policy', 'microphone=(), camera=(), geolocation=()');
    c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');
});

// ── 2. CORS — locked to configured origins only ─────────────────────────────
// Same-origin requests (no Origin header) pass through without CORS checks.
// Cross-origin requests whose Origin is not in ALLOWED_ORIGINS get 403.
app.use('*', async (c, next) => {
    const raw     = c.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://localhost:8787';
    const allowed = raw.split(',').map(o => o.trim()).filter(Boolean);
    const origin  = c.req.header('Origin') ?? '';

    if (origin && !allowed.includes(origin)) {
        return c.json({ error: 'Origin not allowed' }, 403);
    }

    return cors({
        origin: (incoming) => allowed.includes(incoming) ? incoming : '',
        allowMethods: ['GET', 'POST', 'OPTIONS'],
        allowHeaders: ['Content-Type'],
        maxAge: 600,
    })(c, next);
});

// ── 3. Cloudflare Access JWT verification ───────────────────────────────────
// Active only when CLOUDFLARE_TEAM_DOMAIN + CLOUDFLARE_ACCESS_AUD are set.
// In production: put your Worker behind a CF Access Application (Zero Trust
// → Access → Applications) so Cloudflare injects Cf-Access-Jwt-Assertion.
app.use('*', async (c, next) => {
    const { CLOUDFLARE_TEAM_DOMAIN: team, CLOUDFLARE_ACCESS_AUD: aud } = c.env;
    if (!team || !aud) return next(); // dev / pre-Access mode — skip

    const { authorized } = await verifyCloudflareAccess(c.req.raw, team, aud);
    if (!authorized) {
        return c.json({ error: 'Unauthorized' }, 401);
    }
    return next();
});

// ── 4. Per-IP rate limiting ──────────────────────────────────────────────────
// AI-heavy routes: 120 req/min.  Everything else: 180 req/min.
// The IP is SHA-256 hashed before being used as a DO name so raw IPs are
// never stored in the system.
const AI_ROUTE_SUFFIXES = [
    '/voice', '/explore', '/expandResearch',
    '/startDiscovery', '/getInitialSuggestion',
];

async function checkRateLimit(
    ns: DurableObjectNamespace,
    ip: string,
    maxRequests: number,
    windowMs: number,
): Promise<boolean> {
    try {
        const hashBuf = await crypto.subtle.digest(
            'SHA-256', new TextEncoder().encode(ip),
        );
        const key  = Array.from(new Uint8Array(hashBuf))
            .slice(0, 8)
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
        const stub = ns.get(ns.idFromName(`rl:${key}`));
        const res  = await stub.fetch(new Request('http://internal/check', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ maxRequests, windowMs }),
        }));
        const data = await res.json() as { allowed: boolean };
        return data.allowed;
    } catch {
        // Fail open — don't block legitimate users if rate limiter is unavailable
        return true;
    }
}

app.use('/project/:id/*', async (c, next) => {
    const ip    = c.req.header('CF-Connecting-IP') ?? c.req.header('X-Forwarded-For') ?? 'unknown';
    const isAI  = AI_ROUTE_SUFFIXES.some(s => c.req.path.endsWith(s));
    const limit = isAI ? 120 : 180;

    const allowed = await checkRateLimit(c.env.RATE_LIMITER, ip, limit, 60_000);
    if (!allowed) {
        return c.json({ error: 'Rate limit exceeded — please wait before retrying.' }, 429);
    }
    return next();
});

// ════════════════════════════════════════════════════════════════════════════
//  ROUTES
// ════════════════════════════════════════════════════════════════════════════

app.get('/', (c) => c.text('Cerebro API Node Online'));

// ── Voice upload (binary audio, not JSON) ───────────────────────────────────
app.post('/project/:id/voice', async (c) => {
    try {
        const id = c.req.param('id');
        if (!validId(id)) return c.json({ error: 'Invalid project ID' }, 400);

        // Reject obviously wrong content types before reading the body
        const ct = c.req.header('Content-Type') ?? '';
        if (ct && !ct.startsWith('audio/') && ct !== 'application/octet-stream') {
            return c.json({ error: 'Expected audio content type' }, 415);
        }

        const audioData = await c.req.arrayBuffer();
        if (audioData.byteLength > MAX_AUDIO_BYTES) {
            return c.json({ error: 'Audio too large (max 10 MB)' }, 413);
        }

        const stub = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await stub.addNote(new Uint8Array(audioData));
        return c.json(result);
    } catch (e: any) {
        console.error('Voice error:', e);
        return c.json({ error: e.message }, 500);
    }
});

// ── Explore a node topic ────────────────────────────────────────────────────
app.post('/project/:id/explore', async (c) => {
    try {
        const id = c.req.param('id');
        if (!validId(id)) return c.json({ error: 'Invalid project ID' }, 400);

        const raw = await c.req.text();
        if (raw.length > MAX_JSON_BYTES) return c.json({ error: 'Request body too large' }, 413);
        const { nodeId, query } = JSON.parse(raw);

        if (typeof nodeId !== 'string' || !nodeId.trim()) return c.json({ error: 'nodeId required' }, 400);
        if (typeof query  !== 'string' || !query.trim())  return c.json({ error: 'query required' }, 400);
        if (query.length > 500) return c.json({ error: 'query too long (max 500 chars)' }, 400);

        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.exploreTopic(nodeId.trim().slice(0, 100), query.trim());
        return c.json(result);
    } catch (e) {
        return c.json({ error: (e as Error).message }, 500);
    }
});

// ── Expand research from a node ─────────────────────────────────────────────
app.post('/project/:id/expandResearch', async (c) => {
    try {
        const id = c.req.param('id');
        if (!validId(id)) return c.json({ error: 'Invalid project ID' }, 400);

        const raw = await c.req.text();
        if (raw.length > MAX_JSON_BYTES) return c.json({ error: 'Request body too large' }, 413);
        const { nodeId } = JSON.parse(raw);
        if (typeof nodeId !== 'string' || !nodeId.trim()) return c.json({ error: 'nodeId required' }, 400);

        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.expandResearch(nodeId.trim().slice(0, 100));
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// ── Trace log ───────────────────────────────────────────────────────────────
app.get('/project/:id/trace', async (c) => {
    try {
        const id = c.req.param('id');
        if (!validId(id)) return c.json({ error: 'Invalid project ID' }, 400);

        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.getTrace();
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// ── Create / init project ───────────────────────────────────────────────────
app.post('/project/:id/create', async (c) => {
    try {
        const id = c.req.param('id');
        if (!validId(id)) return c.json({ error: 'Invalid project ID' }, 400);

        const raw = await c.req.text();
        if (raw.length > MAX_JSON_BYTES) return c.json({ error: 'Request body too large' }, 413);
        const { name, topic } = JSON.parse(raw);

        if (typeof name !== 'string' || !name.trim()) return c.json({ error: 'name required' }, 400);
        if (name.length > 100) return c.json({ error: 'name too long (max 100 chars)' }, 400);
        if (topic && typeof topic === 'string' && topic.length > 2000) {
            return c.json({ error: 'topic too long (max 2000 chars)' }, 400);
        }

        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.initProject(name.trim(), (topic ?? '').trim().slice(0, 2000));
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// ── Start discovery workflow ─────────────────────────────────────────────────
app.post('/project/:id/startDiscovery', async (c) => {
    try {
        const id = c.req.param('id');
        if (!validId(id)) return c.json({ error: 'Invalid project ID' }, 400);

        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.startDiscovery();
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// ── Update node canvas positions ─────────────────────────────────────────────
app.post('/project/:id/updatePositions', async (c) => {
    try {
        const id = c.req.param('id');
        if (!validId(id)) return c.json({ error: 'Invalid project ID' }, 400);

        const raw = await c.req.text();
        if (raw.length > MAX_JSON_BYTES) return c.json({ error: 'Request body too large' }, 413);
        const body = JSON.parse(raw);

        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.updateNodePositions(body);
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// ── Delete entity / subtree ──────────────────────────────────────────────────
app.post('/project/:id/deleteEntity', async (c) => {
    try {
        const id = c.req.param('id');
        if (!validId(id)) return c.json({ error: 'Invalid project ID' }, 400);

        const raw = await c.req.text();
        if (raw.length > MAX_JSON_BYTES) return c.json({ error: 'Request body too large' }, 413);
        const body = JSON.parse(raw);
        const nodeIds = Array.isArray(body.nodeIds) ? body.nodeIds : [body.nodeId];

        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.deleteEntity(nodeIds);
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// ── Get full project state ───────────────────────────────────────────────────
app.get('/project/:id/getProjectData', async (c) => {
    try {
        const id = c.req.param('id');
        if (!validId(id)) return c.json({ error: 'Invalid project ID' }, 400);

        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.getProjectData();
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// ── Get resonance perspectives for a node ────────────────────────────────────
app.post('/project/:id/getInitialSuggestion', async (c) => {
    try {
        const id = c.req.param('id');
        if (!validId(id)) return c.json({ error: 'Invalid project ID' }, 400);

        const raw = await c.req.text();
        if (raw.length > MAX_JSON_BYTES) return c.json({ error: 'Request body too large' }, 413);
        const { nodeId } = JSON.parse(raw);
        if (typeof nodeId !== 'string' || !nodeId.trim()) return c.json({ error: 'nodeId required' }, 400);

        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.getInitialSuggestion(nodeId.trim().slice(0, 100));
        return c.json(result);
    } catch (e: any) {
        return c.json({ error: e.message }, 500);
    }
});

// Export all DO / Workflow classes so Wrangler can register them
export { CerebroAgent, DeepDiveWorkflow, RateLimiter };
export default app;
