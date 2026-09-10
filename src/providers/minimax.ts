import { httpEndpoint } from '../core/methods.js';
import { BaseProvider, array, object, requestJson } from './shared.js';
import { iso, label, numeric } from '../core/normalize.js';
import { MeterError } from '../core/errors.js';
import type { ProviderUsage, QuotaMeter } from '../core/types.js';
export function parseMiniMax(value: unknown, legacy = false): ProviderUsage {
  const root = object(value), code = numeric(object(root.base_resp).status_code);
  if (code !== undefined && code !== 0) throw new MeterError(code === 1004 ? 'unauthorized' : 'upstream');
  const rows = array(root.model_remains);
  if (!rows.length) throw new MeterError('invalid-response');
  const meters: QuotaMeter[] = [];
  for (const [i, item] of rows.entries()) {
    const r = object(item), scope = label(r.model_name) ?? `pool-${i}`;
    for (const [period, prefix, reset] of [['5h', 'current_interval', 'end_time'], ['Weekly', 'current_weekly', 'weekly_end_time']]) {
      if (!Object.keys(r).some(k => k.startsWith(prefix))) continue;
      const rawPercent = numeric(r[`${prefix}_remaining_percent`]);
      const remainingPercent = rawPercent !== undefined && rawPercent >= 0 ? rawPercent : undefined;
      const limit = numeric(r[`${prefix}_total_count`]);
      // Legacy Coding API's misleading usage_count is the remaining request count.
      // Token Plan counters are not reliable denominators; use its authoritative percent only.
      const remaining = legacy && remainingPercent === undefined ? numeric(r[`${prefix}_usage_count`]) : undefined;
      meters.push({id:`${scope}-${period}`, name:`${scope} · ${period}`, scope,
        kind:legacy && remaining !== undefined ? 'requests' : 'window',
        unit:legacy && remaining !== undefined ? 'requests' : 'percent',
        remainingPercent, remaining,
        limit:legacy && limit !== undefined && limit > 0 ? limit : undefined,
        resetAt:iso(r[reset])});
    }
  }
  if (!meters.length) throw new MeterError('invalid-response');
  return {source:legacy ? 'MiniMax Coding Plan API' : 'MiniMax Token Plan API', meters};
}
export class MiniMaxProvider extends BaseProvider {
  id = 'minimax' as const; name = 'MiniMax';
  async detect() { return (await Promise.all(this.accounts.map(a => this.key(a, 'MINIMAX_API_KEY')))).some(Boolean); }
  async getUsage(id: string, signal: AbortSignal) {
    const a = this.account(id), legacy = a.planType === 'coding';
    return parseMiniMax(await requestJson(httpEndpoint(this.id,a), this.requireKey(await this.key(a, 'MINIMAX_API_KEY')), signal), legacy);
  }
}
