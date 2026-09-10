import { httpEndpoint } from '../core/methods.js';
import { BaseProvider, object, requestJson } from './shared.js';
import { numeric } from '../core/normalize.js';
import { MeterError } from '../core/errors.js';
import type { ProviderUsage } from '../core/types.js';
export function parse302(value: unknown): ProviderUsage {
  const remaining = numeric(object(object(value).data).balance);
  if (remaining === undefined) throw new MeterError('invalid-response');
  return {source:'302.AI balance API', meters:[{id:'balance', name:'Balance', kind:'balance', unit:'money', remaining}]};
}
export class AI302Provider extends BaseProvider {
  id = '302ai' as const; name = '302.AI';
  async detect() { return (await Promise.all(this.accounts.map(a => this.key(a, 'AI_302_API_KEY')))).some(Boolean); }
  async getUsage(id: string, signal: AbortSignal) {
    return parse302(await requestJson(httpEndpoint(this.id), this.requireKey(await this.key(this.account(id), 'AI_302_API_KEY')), signal));
  }
}
