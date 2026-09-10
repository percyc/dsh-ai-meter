export class AsyncCache<T> {
  private entries = new Map<string, {value: T; expires: number}>();
  private pending = new Map<string, Promise<T>>();
  constructor(private ttl: number, private clock = Date.now) {}
  peek(key: string): T | undefined { return this.entries.get(key)?.value; }
  expiresAt(key:string):number { return this.entries.get(key)?.expires ?? 0; }
  async get(key: string, loader: () => Promise<T>, force = false, lifetime: (value:T)=>number = ()=>this.ttl): Promise<T> {
    const cached = this.entries.get(key);
    if (!force && cached && this.clock() < cached.expires) return structuredClone(cached.value);
    let pending = this.pending.get(key);
    if (!pending) {
      pending = loader().then(value => {
        this.entries.set(key, {value: structuredClone(value), expires: this.clock() + lifetime(value)});
        return value;
      }).finally(() => this.pending.delete(key));
      this.pending.set(key, pending);
    }
    return structuredClone(await pending);
  }
}
