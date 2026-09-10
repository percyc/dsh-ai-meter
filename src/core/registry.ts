import { AsyncCache } from './cache.js';
import { MeterError, errorCode } from './errors.js';
import { health, normalizeMeter, overview } from './normalize.js';
import { snapshotSchema, type Account, type ProviderId, type QuotaProvider, type QuotaSnapshot } from './types.js';

export class MeterRegistry {
  private providers = new Map<ProviderId, QuotaProvider>();
  private cache: AsyncCache<QuotaSnapshot>;
  private active = new Set<AbortController>();
  private disposed = false;
  constructor(private options = {cacheTtlMs: 120_000, timeoutMs: 15_000, lowQuotaPercent: 10}, private clock = Date.now) {
    this.cache = new AsyncCache(options.cacheTtlMs, clock);
  }
  register(provider: QuotaProvider) {
    if (this.providers.has(provider.id)) throw new Error('Duplicate provider');
    this.providers.set(provider.id, provider);
    return this;
  }
  private async bounded<T>(work: Promise<T>): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new MeterError('timeout')), this.options.timeoutMs);
    })]); } finally { clearTimeout(timer); }
  }
  async listProviders() {
    return Promise.all([...this.providers.values()].map(async p => {
      try { return {id:p.id, name:p.name, detected:await this.bounded(p.detect()), accounts:await this.bounded(p.getAccounts())}; }
      catch { return {id:p.id, name:p.name, detected:false, accounts:[]}; }
    }));
  }
  async getUsage(provider: ProviderId, account?: string, force = false): Promise<QuotaSnapshot> {
    const p = this.providers.get(provider);
    if (!p) throw new MeterError('unsupported');
    let accounts: Account[];
    let accountError: unknown;
    try { accounts = await this.bounded(p.getAccounts()); } catch (e) { accountError = e; accounts = [{id:'default', name:'Default'}]; }
    const selected = account ? accounts.find(a => a.id === account) : accounts[0];
    if (!selected) throw new MeterError('not-configured');
    const key = JSON.stringify([provider, selected.id]);
    return this.cache.get(key, async () => {
      const controller = new AbortController();
      this.active.add(controller);
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        if (this.disposed) throw new MeterError('unsupported');
        if (accountError) throw accountError;
        const aborted = new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => reject(new MeterError('timeout')), {once:true});
          timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
        });
        const value = await Promise.race([p.getUsage(selected.id, controller.signal), aborted]);
        const now = this.clock();
        const parsed = snapshotSchema.safeParse({provider, account:selected, ...value,
          meters:value.meters.map(normalizeMeter), status:'ok', fetchedAt:new Date(now).toISOString(),
          checkedAt:new Date(now).toISOString(), expiresAt:new Date(now + this.options.cacheTtlMs).toISOString()});
        if (!parsed.success) throw new MeterError('invalid-response');
        if (!parsed.data.meters.length) throw new MeterError('unsupported');
        return parsed.data;
      } catch (e) {
        const code = errorCode(e);
        const previous = this.cache.peek(key);
        const now = new Date(this.clock()).toISOString();
        if (previous?.meters.length) return {...previous, status:'stale', error:code, checkedAt:now, expiresAt:now};
        return {provider, account:selected, meters:[], source:provider, fetchedAt:now, checkedAt:now, expiresAt:now,
          status:code === 'not-configured' || code === 'not-installed' ? 'not-configured' : code === 'unsupported' ? 'unsupported' : 'error', error:code};
      } finally { clearTimeout(timer); this.active.delete(controller); }
    }, force);
  }
  async getAllUsage(filter?: ProviderId[], force = false, include: (provider:ProviderId,account:string)=>boolean = ()=>true) {
    const ids = filter ?? [...this.providers.keys()];
    if (ids.some(id => !this.providers.has(id))) throw new MeterError('unsupported');
    const lists = await Promise.all([...this.providers.values()].filter(p => ids.includes(p.id)).map(async p => {
      try { return {id:p.id, accounts:await this.bounded(p.getAccounts())}; }
      catch { return {id:p.id, accounts:[{id:'default', name:'Default'}]}; }
    }));
    const snapshots = await Promise.all(lists.flatMap(p => p.accounts.filter(a=>include(p.id,a.id)).map(a => this.getUsage(p.id, a.id, force))));
    return overview(snapshots, this.clock(), this.options.lowQuotaPercent);
  }
  refresh(filter?: ProviderId[]) { return this.getAllUsage(filter, true); }
  async getHealth(filter?: ProviderId[]) {
    return (await this.getAllUsage(filter)).snapshots.map(s => ({provider:s.provider, account:s.account.id, health:health(s, this.options.lowQuotaPercent, this.clock())}));
  }
  async getAvailableProviders(filter?: ProviderId[]) {
    // Conservative account-level readiness, not a model recommendation or capability guarantee.
    return (await this.getHealth(filter)).filter(s => s.health === 'healthy');
  }
  dispose() { this.disposed = true; for (const c of this.active) c.abort(); }
}
