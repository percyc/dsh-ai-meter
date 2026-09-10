import { commandPlan, executablePlan } from './command.js';
import { effectiveQuery } from '../core/channel.js';
import { httpEndpoint } from '../core/methods.js';
import { BaseProvider, array, object, requestJson, runJson, findCommand } from './shared.js';
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
    // Match official MiniMax CLI 1.0.25: both zero totals + both status=3 means not in plan.
    const unsupported = r.current_interval_total_count === 0 && r.current_weekly_total_count === 0 && r.current_interval_status === 3 && r.current_weekly_status === 3;
    const start = iso(r.start_time), end = iso(r.end_time);
    const hours = start && end ? (Date.parse(end)-Date.parse(start))/3600000 : undefined;
    const intervalName = hours && hours > 0 ? `${hours}h` : '当前周期';
    for (const [period, prefix, reset] of [['5h', 'current_interval', 'end_time'], ['Weekly', 'current_weekly', 'weekly_end_time']]) {
      if (!Object.keys(r).some(k => k.startsWith(prefix))) continue;
      const rawPercent = numeric(r[`${prefix}_remaining_percent`]);
      const entitlement = unsupported ? 'unsupported' : period === 'Weekly' && r.current_weekly_status === 3 ? 'unlimited' : undefined;
      const boost = period === 'Weekly' ? numeric(r.weekly_boost_permille) : undefined;
      const remainingPercent = !entitlement && rawPercent !== undefined && rawPercent >= 0 ? rawPercent * (boost === undefined ? 1 : Math.max(0, boost)/1000) : undefined;
      const limit = numeric(r[`${prefix}_total_count`]);
      // Legacy Coding API's misleading usage_count is the remaining request count.
      // Token Plan counters are not reliable denominators; use its authoritative percent only.
      const remaining = !entitlement && legacy && remainingPercent === undefined ? numeric(r[`${prefix}_usage_count`]) : undefined;
      meters.push({id:`${scope}-${period}`, name:`${scope} · ${period === '5h' ? intervalName : period}`, scope, entitlement,
        kind:legacy && remaining !== undefined ? 'requests' : 'window',
        unit:legacy && remaining !== undefined ? 'requests' : 'percent',
        remainingPercent, remaining,
        limit:!entitlement && legacy && limit !== undefined && limit > 0 ? limit : undefined,
        resetAt:entitlement ? undefined : iso(r[reset])});
    }
  }
  if (!meters.length) throw new MeterError('invalid-response');
  return {source:legacy ? 'MiniMax Coding Plan API' : 'MiniMax Token Plan API', meters};
}
export class MiniMaxProvider extends BaseProvider {
  id = 'minimax' as const; name = 'MiniMax';
  async detect() { return (await Promise.all(this.accounts.map(a => effectiveQuery(this.id,a).kind === 'cli' ? findCommand(commandPlan(a,'mmx',[],'HOME').command) : this.key(a, 'MINIMAX_API_KEY')))).some(Boolean); }
  async getUsage(id: string, signal: AbortSignal) {
    const a = this.account(id), legacy = a.planType === 'coding';
    if (effectiveQuery(this.id,a).kind === 'cli') {
      if(a.args?.length)throw new MeterError('unsupported');
      const plan = await executablePlan(a,'mmx',['quota','show','--non-interactive','--quiet','--output','json'],'HOME');
      const usage = parseMiniMax(await runJson(plan.command,plan.args,signal,undefined,plan.env));
      return {...usage,source:'Official mmx quota show (Token Plan)'};
    }
    return parseMiniMax(await requestJson(httpEndpoint(this.id,a), this.requireKey(await this.key(a, 'MINIMAX_API_KEY')), signal), legacy);
  }
}
