import { SpendingError, errorResponse, fingerprint, network, policy, type SpendingEnv } from "./policy";

type Hold = { day: string; owner: string; amount: number; expires: number; settled?: boolean };
type Total = { spent: number; holds: Record<string, number> };
const empty = (): Total => ({ spent: 0, holds: {} });
export class FreeBudget {
  private lookups = new Map<string, Promise<boolean>>();
  constructor(private state: DurableObjectState, private env: SpendingEnv) {}
  async fetch(request: Request): Promise<Response> {
    try {
      if (await this.state.storage.getAlarm() === null) await this.state.storage.setAlarm(Date.now() + 86400000);
      if (new URL(request.url).pathname === "/status") {
        const limits = policy(this.env);
        const day = new Date().toISOString().slice(0, 10);
        const oldest = new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);
        const total = await this.state.storage.get<Total>(`total:${day}`) ?? empty();
        const counts = await this.state.storage.list<number>({ prefix: "spur:" });
        return Response.json({ used: total.spent, limit: limits.daily,
          lookups: [...counts].filter(([key]) => key.slice(5) >= oldest).reduce((sum, [, value]) => sum + value, 0), lookupLimit: limits.spurMonthly });
      }
      const body = await request.json() as Record<string, unknown>;
      if (new URL(request.url).pathname === "/settle") {
        await this.settle(String(body.id), Number(body.used));
        return Response.json({ ok: true });
      }
      return Response.json(await this.reserve(body));
    } catch (error) {
      return errorResponse(error instanceof SpendingError ? error : new SpendingError(503, "spending_unavailable", "Free admission is temporarily unavailable."));
    }
  }
  private async reputation(ip: string, owner: string): Promise<boolean> {
    const existing = this.lookups.get(owner);
    if (existing) return existing;
    if (this.lookups.size >= policy(this.env).concurrency) throw new SpendingError(503, "reputation_unavailable", "Free access verification is at capacity.");
    const run = this.lookup(ip, owner);
    this.lookups.set(owner, run);
    try { return await run; } finally { this.lookups.delete(owner); }
  }
  private async lookup(ip: string, owner: string): Promise<boolean> {
    const key = `rep:${owner}`;
    const cached = await this.state.storage.get<{ allowed: boolean | null; expires: number }>(key);
    if (cached && cached.expires > Date.now()) {
      if (cached.allowed === null) throw new SpendingError(503, "reputation_unavailable", "Free access verification is temporarily unavailable.", { retryAfter: 30 });
      return cached.allowed;
    }
    if (!this.env.SPUR_API_KEY) throw new SpendingError(503, "reputation_unavailable", "Free access verification is unavailable; use a funded API key.");
    const day = new Date().toISOString().slice(0, 10);
    const oldest = new Date(Date.now() - 31 * 86400000).toISOString().slice(0, 10);
    await this.state.storage.transaction(async tx => {
      const counts = await tx.list<number>({ prefix: "spur:" });
      const used = [...counts].filter(([key]) => key.slice(5) >= oldest).reduce((sum, [, value]) => sum + value, 0);
      if (used >= policy(this.env).spurMonthly) throw new SpendingError(503, "reputation_budget", "Free access verification is at capacity; use a funded API key.");
      await tx.put(`spur:${day}`, (counts.get(`spur:${day}`) ?? 0) + 1);
    });
    try {
      const response = await fetch(`https://api.spur.us/v2/context/${encodeURIComponent(ip)}`, { headers: { Token: this.env.SPUR_API_KEY }, signal: AbortSignal.timeout(1500) });
      if (!response.ok) throw new Error("Spur refused the lookup");
      const context = await response.json() as { tunnels?: { anonymous?: boolean; categories?: string[] }[]; risks?: string[]; client?: { proxies?: unknown[] } };
      const allowed = !context.tunnels?.some(t => t.anonymous === true || t.categories?.includes("RESIDENTIAL_PROXY")) && !context.risks?.includes("CALLBACK_PROXY") && !context.client?.proxies?.length;
      await this.state.storage.put(key, { allowed: !!allowed, expires: Date.now() + 86400000 });
      return !!allowed;
    } catch {
      await this.state.storage.put(key, { allowed: null, expires: Date.now() + 30000 });
      throw new SpendingError(503, "reputation_unavailable", "Free access verification is temporarily unavailable.", { retryAfter: 30 });
    }
  }
  private async reserve(body: Record<string, unknown>) {
    const ip = String(body.ip ?? "");
    const operator = body.operator === true;
    const net = operator ? "authenticated-operator" : network(ip);
    const day = new Date().toISOString().slice(0, 10);
    const previous = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    const [owner, prior] = await Promise.all([fingerprint(this.env, `${day}:${net}`), fingerprint(this.env, `${previous}:${net}`)]);
    const limits = policy(this.env);
    const id = crypto.randomUUID();
    const amount = limits.request;
    const daily = operator ? limits.operatorDaily : limits.daily;
    const ipDaily = operator ? limits.operatorDaily : limits.ipDaily;
    const reserve = async (commit: boolean) => this.state.storage.transaction(async tx => {
      const global = await tx.get<Total>(`total:${day}`) ?? empty();
      const mine = await tx.get<Total>(`ip:${day}:${owner}`) ?? empty();
      const yesterday = await tx.get<Total>(`ip:${previous}:${prior}`) ?? empty();
      const active = Object.values(mine.holds).filter(t => t > Date.now()).length + Object.values(yesterday.holds).filter(t => t > Date.now()).length;
      const globalPrior = await tx.get<Total>(`total:${previous}`) ?? empty();
      const allActive = Object.values(global.holds).filter(t => t > Date.now()).length + Object.values(globalPrior.holds).filter(t => t > Date.now()).length;
      const retryAfter = Math.ceil((Date.parse(`${day}T00:00:00Z`) + 86400000 - Date.now()) / 1000);
      if (global.spent + amount > daily)
        throw new SpendingError(429, operator ? "operator_daily_budget" : "free_daily_budget", `The ${operator ? "operator" : "shared free"} budget is spent or reserved ($${daily / 1e9} per UTC day).`, { retryAfter, limitUsd: daily / 1e9, availableUsd: Math.max(0, daily - global.spent) / 1e9 });
      if (mine.spent + amount > ipDaily)
        throw new SpendingError(429, "free_ip_daily_budget", `This IP network's free budget is spent or reserved ($${limits.ipDaily / 1e9} per UTC day).`, { retryAfter, limitUsd: limits.ipDaily / 1e9, availableUsd: Math.max(0, limits.ipDaily - mine.spent) / 1e9 });
      if (active >= limits.ipConcurrency)
        throw new SpendingError(429, "free_ip_concurrency", `At most ${limits.ipConcurrency} free requests may run at once per IP network.`, { retryAfter: 2, limit: limits.ipConcurrency });
      if (allActive >= limits.concurrency)
        throw new SpendingError(429, "free_capacity", "The free inference pool is at capacity.", { retryAfter: 2 });
      const idem = typeof body.idempotency === "string" ? await fingerprint(this.env, `${owner}:${body.idempotency}`) : undefined;
      if (idem && await tx.get(`idem:${day}:${idem}`)) throw new SpendingError(409, "duplicate_request", "This idempotency key was already admitted today. No additional work was started.");
      if (!commit) return;
      for (const total of [global, mine]) for (const [key, expires] of Object.entries(total.holds))
        if (expires <= Date.now()) delete total.holds[key];
      const expires = Date.now() + 180000;
      global.spent += amount; mine.spent += amount;
      global.holds[id] = expires; mine.holds[id] = expires;
      await tx.put(`total:${day}`, global); await tx.put(`ip:${day}:${owner}`, mine);
      await tx.put(`hold:${id}`, { day, owner, amount, expires } satisfies Hold);
      if (idem) await tx.put(`idem:${day}:${idem}`, id);
    });
    await reserve(false);
    if (!operator && !await this.reputation(ip, `${day}:${owner}`)) throw new SpendingError(403, "proxy_requires_payment", "Anonymous proxy traffic requires a funded API key.");
    await reserve(true);
    return { id, amount, expires: Date.now() + 90000 };
  }
  private async settle(id: string, used: number) {
    if (!Number.isSafeInteger(used) || used < 0) throw new SpendingError(400, "invalid_settlement", "Invalid spending settlement.");
    await this.state.storage.transaction(async tx => {
      const hold = await tx.get<Hold>(`hold:${id}`);
      if (!hold || hold.settled) return;
      // An expired hold keeps its full cost: lost responses must not mint credit.
      const refund = hold.expires > Date.now() ? Math.max(0, hold.amount - used) : 0;
      for (const key of [`total:${hold.day}`, `ip:${hold.day}:${hold.owner}`]) {
        const total = await tx.get<Total>(key);
        if (total) { total.spent -= refund; delete total.holds[id]; await tx.put(key, total); }
      }
      await tx.put(`hold:${id}`, { ...hold, settled: true });
    });
  }
  async alarm() {
    const cutoff = new Date(Date.now() - 2 * 86400000).toISOString().slice(0, 10);
    let startAfter: string | undefined;
    for (;;) {
      const rows = await this.state.storage.list<unknown>({ limit: 256, ...(startAfter ? { startAfter } : {}) });
      if (!rows.size) break;
      for (const [key, value] of rows) {
        startAfter = key;
        if ((key.startsWith("hold:") && (value as Hold).day < cutoff) ||
            (/^(ip|idem|total):/.test(key) && key.split(":")[1] < cutoff) ||
            (key.startsWith("rep:") && (value as { expires: number }).expires < Date.now()) ||
            (key.startsWith("spur:") && key.slice(5) < new Date(Date.now() - 32 * 86400000).toISOString().slice(0, 10))) await this.state.storage.delete(key);
      }
    }
    await this.state.storage.setAlarm(Date.now() + 86400000);
  }
}
