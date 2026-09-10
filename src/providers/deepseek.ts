import { httpEndpoint } from '../core/methods.js';
import { BaseProvider, array, object, requestJson } from './shared.js';
import { numeric, label } from '../core/normalize.js';
import { MeterError } from '../core/errors.js';
import type { ProviderUsage } from '../core/types.js';
export function parseDeepSeek(value: unknown): ProviderUsage {
  const infos = array(object(value).balance_infos);
  if (!infos.length) throw new MeterError('invalid-response');
  return {source:'DeepSeek balance API', meters:infos.map((item, i) => {
    const b = object(item), remaining = numeric(b.total_balance);
    if (remaining === undefined) throw new MeterError('invalid-response');
    return {id:`balance-${label(b.currency) ?? i}`, name:'Balance', kind:'balance', unit:'money', remaining, currency:label(b.currency)};
  })};
}
export class DeepSeekProvider extends BaseProvider {
  id = 'deepseek' as const; name = 'DeepSeek';
  async detect() { return (await Promise.all(this.accounts.map(a => this.key(a, 'DEEPSEEK_API_KEY')))).some(Boolean); }
  async getUsage(id: string, signal: AbortSignal) {
    return parseDeepSeek(await requestJson(httpEndpoint(this.id), this.requireKey(await this.key(this.account(id), 'DEEPSEEK_API_KEY')), signal));
  }
}
