/**
 * RateLimiter — Durable Object for per-IP sliding-window rate limiting.
 *
 * Each DO instance is keyed by a hashed IP (never the raw IP), so one
 * instance = one client.  Storage is durable across Worker restarts.
 *
 * POST /check  {maxRequests: number, windowMs: number}
 *   → 200  {allowed: true,  remaining: number, resetAt: timestamp}
 *   → 429  {allowed: false, remaining: 0,       resetAt: timestamp}
 */

interface RateLimitRequest {
    maxRequests: number;
    windowMs: number;
}

interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
}

export class RateLimiter {
    private storage: DurableObjectStorage;

    constructor(state: DurableObjectState, _env: unknown) {
        this.storage = state.storage;
    }

    async fetch(request: Request): Promise<Response> {
        let body: RateLimitRequest;
        try {
            body = await request.json() as RateLimitRequest;
        } catch {
            return Response.json({ error: 'Invalid request body' }, { status: 400 });
        }

        const { maxRequests, windowMs } = body;
        if (
            typeof maxRequests !== 'number' || maxRequests < 1 ||
            typeof windowMs !== 'number'    || windowMs < 1
        ) {
            return Response.json({ error: 'Invalid parameters' }, { status: 400 });
        }

        const now = Date.now();
        const cutoff = now - windowMs;

        // Load the sliding window (array of UTC timestamps for past requests)
        const timestamps: number[] = (await this.storage.get<number[]>('ts')) ?? [];

        // Drop entries older than the window
        const recent = timestamps.filter(t => t > cutoff);

        if (recent.length >= maxRequests) {
            // The earliest entry's expiry is when the window resets for this client
            const resetAt = recent[0] + windowMs;
            const result: RateLimitResult = { allowed: false, remaining: 0, resetAt };
            return Response.json(result, { status: 429 });
        }

        recent.push(now);
        await this.storage.put('ts', recent);

        // Schedule alarm to clean up stale DOs so they don't accumulate forever
        const alarm = await this.storage.getAlarm();
        if (alarm === null) {
            await this.storage.setAlarm(now + windowMs * 2);
        }

        const result: RateLimitResult = {
            allowed: true,
            remaining: maxRequests - recent.length,
            resetAt: now + windowMs,
        };
        return Response.json(result, { status: 200 });
    }

    /** Alarm fires after inactivity — delete all state to free storage. */
    async alarm(): Promise<void> {
        await this.storage.deleteAll();
    }
}
