import { AsyncCache } from './cache.js';
import { MeterError, errorCode } from './errors.js';
import { health, normalizeMeter, overview } from './normalize.js';
import { snapshotSchema, type Account, type ProviderId, type QuotaProvider, type QuotaSnapshot } from './types.js';

export class MeterRegistry {
  private providers = new Map<ProviderId, QuotaProvider>();
  private cache: AsyncCache<QuotaSnapshot>;
  private active = new Set<AbortController>();
  private disposed = false;
  private running = 0;
  private queue: (()=>void)[] = [];
  private failures = new Map<string,number>();
  private views = new Map<string,Promise<QuotaSnapshot>>();
  private async acquire() {
    if(this.running >= 3)await new Promise<void>(resolve=>this.queue.push(resolve));
    else this.running++;
    return ()=>{const next=this.queue.shift();if(next)next();else this.running--;};
  }
  constructor(private options = {cacheTtlMs: 120_000, timeoutMs: 15_000, lowQuotaPercent: 10}, private clock = Date.now, private interval?: (provider:ProviderId,account:string)=>number) {
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
      const release=await this.acquire();
      const ttl=this.interval?.(provider,selected.id) ?? this.options.cacheTtlMs;
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
        const resets=value.meters.map(m=>m.resetAt?Date.parse(m.resetAt):NaN).filter(t=>t>now);
        const nextCheckAt=new Date(Math.min(now+ttl,...resets)).toISOString();
        const parsed = snapshotSchema.safeParse({provider, account:selected, ...value,
          meters:value.meters.map(normalizeMeter), status:'ok',nextCheckAt, fetchedAt:new Date(now).toISOString(),
          checkedAt:new Date(now).toISOString(), expiresAt:new Date(now + ttl).toISOString()});
        if (!parsed.success) throw new MeterError('invalid-response');
        if (!parsed.data.meters.length) throw new MeterError('unsupported');
        this.failures.delete(key);
        return parsed.data;
      } catch (e) {
        const code = errorCode(e);
        const previous = this.cache.peek(key);
        const now = new Date(this.clock()).toISOString();
        const failures=(this.failures.get(key) ?? 0)+1;this.failures.set(key,failures);
        const nextCheckAt=new Date(this.clock()+Math.min(1800000,ttl*2**Math.min(5,failures-1))).toISOString();
        if (previous?.meters.length) return {...previous, status:'stale', error:code, nextCheckAt, checkedAt:now, expiresAt:now};
        return {provider, account:selected, meters:[], source:provider, nextCheckAt, fetchedAt:now, checkedAt:now, expiresAt:now,
          status:code === 'not-configured' || code === 'not-installed' ? 'not-configured' : code === 'unsupported' ? 'unsupported' : 'error', error:code};
      } finally { clearTimeout(timer); this.active.delete(controller);release(); }
    }, force, value=>Math.max(1,Date.parse(value.nextCheckAt ?? value.expiresAt)-this.clock()));
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
  // Called by a visible UI only. Start due work, return cached/placeholder rows immediately.
  // There is no scheduler or timer that starts new collection after the view closes.
  async getUsageView(force=false, include:(provider:ProviderId,account:string)=>boolean=()=>true, collect=true) {
    const lists=await Promise.all([...this.providers.values()].map(async p=>{
      try{return {id:p.id,accounts:await this.bounded(p.getAccounts())};}
      catch{return {id:p.id,accounts:[{id:'default',name:'Default'}]};}
    }));
    const now=this.clock(),stamp=new Date(now).toISOString();
    const snapshots=lists.flatMap(p=>p.accounts.filter(a=>include(p.id,a.id)).map(account=>{
      const key=JSON.stringify([p.id,account.id]);
      if(collect && !this.disposed && !this.views.has(key) && (force || this.cache.expiresAt(key)<=now)){
        const pending=this.getUsage(p.id,account.id,force);
        this.views.set(key,pending);
        void pending.catch(()=>{}).finally(()=>{if(this.views.get(key)===pending)this.views.delete(key);});
      }
      const cached=structuredClone(this.cache.peek(key));
      return {...(cached ?? {provider:p.id,account,meters:[],status:'ok' as const,source:p.id,fetchedAt:stamp,checkedAt:stamp,expiresAt:stamp}),pending:this.views.has(key)};
    }));
    return overview(snapshots,now,this.options.lowQuotaPercent);
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
