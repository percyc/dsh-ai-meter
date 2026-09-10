import { httpEndpoint } from '../core/methods.js';
import { join } from 'node:path';
import { BaseProvider, accountHome, array, object, readJson, requestJson, type AccountConfig } from './shared.js';
import { iso, numeric, label as labelWindow } from '../core/normalize.js';
import { MeterError } from '../core/errors.js';
import type { ProviderUsage, QuotaMeter } from '../core/types.js';
export function parseKimi(value: unknown): ProviderUsage {
  const r = object(value), meters: QuotaMeter[] = [];
  function add(id: string, name: string, value: unknown) {
    const d = object(value), limit = numeric(d.limit), used = numeric(d.used), remaining = numeric(d.remaining);
    // The API calls these quota units; do not label them requests/tokens without evidence.
    meters.push({id, name, kind:'window', unit:'unknown', used, limit, remaining, resetAt:iso(d.resetTime)});
  }
  array(r.limits).forEach((item, i) => {
    const w = object(item), window = object(w.window), n = numeric(window.duration);
    const unit = {TIME_UNIT_MINUTE:'m', TIME_UNIT_HOUR:'h', TIME_UNIT_DAY:'d', TIME_UNIT_WEEK:'w'}[String(window.timeUnit)];
    add(`window-${labelWindow(window.timeUnit)}-${n ?? i}`, n === 300 && unit === 'm' ? '5h' : n && unit ? `${n}${unit}` : 'Window', w.detail);
  });
  if (r.usage) add('weekly', 'Weekly', r.usage);
  if (!meters.length) throw new MeterError('invalid-response');
  return {source:'Kimi Coding usages API', meters};
}
export class KimiProvider extends BaseProvider {
  id = 'kimi' as const; name = 'Kimi';
  private async credential(a: AccountConfig) {
    const key = await this.key(a, 'KIMI_CODE_ACCESS_TOKEN');
    if (key || a.credentialEnv || (a.query?.kind==='http' && a.query.auth==='api-key')) return key;
    for (const dir of ['.kimi-code', '.kimi']) {
      const credentials = await readJson(join(accountHome(a), dir, 'credentials', 'kimi-code.json'));
      if (typeof credentials.access_token === 'string') return credentials.access_token;
    }
  }
  async detect() { return (await Promise.all(this.accounts.map(a => this.credential(a)))).some(Boolean); }
  async getUsage(id: string, signal: AbortSignal) {
    return parseKimi(await requestJson(httpEndpoint(this.id), this.requireKey(await this.credential(this.account(id))), signal));
  }
}
