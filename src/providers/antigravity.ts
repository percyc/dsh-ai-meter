import { stripVTControlCharacters } from 'node:util';
import { createHash } from 'node:crypto';
import { executablePlan, commandPlan } from './command.js';
import { BaseProvider, findCommand, runText } from './shared.js';
import { iso } from '../core/normalize.js';
import { MeterError } from '../core/errors.js';
import type { ProviderUsage, QuotaMeter } from '../core/types.js';

// Official agy --print /usage emits tab-separated text, not model-generated JSON.
export function parseAntigravity(value: unknown): ProviderUsage {
  if(typeof value!=='string')throw new MeterError('invalid-response');
  const lines=stripVTControlCharacters(value).split(/\r?\n/).filter(line=>line.trim());
  if(!lines.length)throw new MeterError('unsupported');
  const meters:QuotaMeter[]=[],seen=new Set<string>();
  for(const line of lines){
    const fields=line.split('\t').map(s=>s.trim());
    if(fields.length!==4)throw new MeterError('invalid-response');
    const [group,window,percent,reset]=fields;
    const resetAt=iso(reset);
    if(!group || !window || group.length>160 || window.length>160 || !/^\d+(?:\.\d+)?%$/.test(percent) || Number(percent.slice(0,-1))>100 || !resetAt)throw new MeterError('invalid-response');
    const scope=group==='Gemini Models'?'gemini':group==='Claude and GPT models'?'claude-gpt':`group-${createHash('sha256').update(group).digest('hex').slice(0,16)}`;
    const period=window==='Weekly Limit Remaining'?'weekly':window==='Five Hour Limit Remaining'?'5h':`window-${createHash('sha256').update(window).digest('hex').slice(0,16)}`;
    const id=`${scope}-${period}`;
    if(seen.has(id))throw new MeterError('invalid-response');
    seen.add(id);
    meters.push({id,name:`${scope==='gemini'?'Gemini':scope==='claude-gpt'?'Claude / GPT':group} · ${period==='weekly'?'Weekly':period==='5h'?'5h':window}`,kind:'window',unit:'percent',scope,remainingPercent:Number(percent.slice(0,-1)),resetAt});
  }
  return {source:'Official agy --print /usage',meters};
}
export class AntigravityProvider extends BaseProvider {
  id = 'antigravity' as const; name = 'Antigravity';
  async detect() { return (await Promise.all(this.accounts.map(a => findCommand(commandPlan(a,a.command ?? 'agy',[],'HOME').command)))).some(Boolean); }
  async getUsage(id: string, signal: AbortSignal) {
    const a = this.account(id),command=a.query?.kind==='cli'?a.query.executable ?? a.command ?? 'agy':a.command ?? 'agy';
    // Do not execute legacy third-party bridge configurations or arbitrary prompt args.
    if(/agy-quota/i.test(command) || a.args?.length)throw new MeterError('unsupported');
    const plan=await executablePlan(a,command,['--print','/usage'],'HOME');
    return parseAntigravity(await runText(plan.command,plan.args,signal,undefined,plan.env));
  }
}
