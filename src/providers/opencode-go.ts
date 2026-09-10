import { httpEndpoint } from '../core/methods.js';
import { join } from 'node:path';
import { BaseProvider, accountHome, object, readJson, requestJson, type AccountConfig } from './shared.js';
import { label, percent, iso } from '../core/normalize.js';
import { MeterError } from '../core/errors.js';
import type { ProviderUsage, QuotaMeter } from '../core/types.js';
export function parseOpenCode(value: unknown): ProviderUsage {
  const root = object(value), usage = object(root.usage ?? root);
  const meters: QuotaMeter[] = [];
  for (const [id, name] of [['rolling', '5h'], ['weekly', 'Weekly'], ['monthly', 'Monthly']]) {
    if (!(id in usage)) continue;
    const w = object(usage[id]); const used = percent(w.percent);
    meters.push({id, name, kind:'window', unit:'percent', remainingPercent:used === undefined ? undefined : 100-used, resetAt:iso(w.resetsAt)});
  }
  if (!meters.length) throw new MeterError('invalid-response');
  return {meters, plan:label(root.plan), source:'OpenCode Go usage API'};
}
export class OpenCodeProvider extends BaseProvider {
  id = 'opencode-go' as const; name = 'OpenCode Go';
  private async credential(a: AccountConfig) {
    const key = await this.key(a, 'OPENCODE_GO_API_KEY');
    if (key || a.credentialEnv || (a.query?.kind==='http' && a.query.auth==='api-key')) return key;
    const dir = a.home ? join(a.home, '.local', 'share') : process.env.XDG_DATA_HOME ?? join(accountHome(a), '.local', 'share');
    const auth = await readJson(join(dir, 'opencode', 'auth.json'));
    const entry = object(auth['opencode-go']);
    return entry.type === 'api' && typeof entry.key === 'string' ? entry.key : undefined;
  }
  async detect() { return (await Promise.all(this.accounts.map(a => this.credential(a)))).some(Boolean); }
  async getUsage(id: string, signal: AbortSignal) {
    const key = this.requireKey(await this.credential(this.account(id)));
    return parseOpenCode(await requestJson(httpEndpoint(this.id), key, signal));
  }
}
