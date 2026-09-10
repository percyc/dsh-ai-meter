import { BaseProvider, array, object, runJson, findCommand } from './shared.js';
import { commandPlan, executablePlan } from './command.js';
import { iso, label, numeric, percent } from '../core/normalize.js';
import { MeterError } from '../core/errors.js';
import { arkProducts } from '../core/channel.js';
import type { ProviderUsage, QuotaMeter } from '../core/types.js';
const names:Record<string,string>={'agent-plan':'Agent Plan','coding-plan':'Coding Plan','agent-plan-team':'Agent Plan 团队','coding-plan-team':'Coding Plan 团队'};
const periods:Record<string,string>={session:'本周期','5h':'5h',weekly:'Weekly',monthly:'Monthly'};
export function parseVolcengine(value:unknown):ProviderUsage {
  const root=object(value);
  if(!Array.isArray(root.items))throw new MeterError('invalid-response');
  const meters:QuotaMeter[]=[],plans:string[]=[],seen=new Set<string>();
  for(const raw of root.items){
    const item=object(raw),product=label(item.product);
    if(!product || !arkProducts.includes(product as typeof arkProducts[number]) || seen.has(product))throw new MeterError('invalid-response');
    seen.add(product);
    // Never send viewer identity, seat IDs or raw upstream errors to the browser.
    if(item.error){meters.push({id:`${product}-unavailable`,name:`${names[product]} · 查询未完成`,kind:'window',unit:'unknown',scope:product});continue;}
    if(item.subscribed===false)continue;
    if(item.subscribed!==true)throw new MeterError('invalid-response');
    const tier=label(item.tier);plans.push(`${names[product]}${tier?` ${tier}`:''}`);
    const rows=array(item.periods),ids=new Set<string>();
    if(!rows.length){meters.push({id:`${product}-unavailable`,name:`${names[product]} · 额度待提供`,kind:'window',unit:'unknown',scope:product});continue;}
    for(const row of rows){
      const p=object(row),period=label(p.label);
      if(!period || ids.has(period))throw new MeterError('invalid-response');ids.add(period);
      const rawTotal=numeric(p.total),rawUsed=numeric(p.used),usedPercent=percent(p.percent);
      const absolute=product.startsWith('agent-plan') && rawTotal!==undefined && rawTotal>0 && rawUsed!==undefined && rawUsed>=0;
      // A zero total is not evidence of unlimited quota or a fully available pool.
      const remainingPercent=rawTotal===0?undefined:usedPercent!==undefined?100-usedPercent:absolute?Math.max(0,100-rawUsed/rawTotal*100):undefined;
      meters.push({id:`${product}-${period}`,name:`${names[product]} · ${periods[period] ?? period}`,scope:product,kind:'window',unit:absolute?'afp':'percent',
        remainingPercent,used:absolute?rawUsed:undefined,limit:absolute?rawTotal:undefined,remaining:absolute?Math.max(0,rawTotal-rawUsed):undefined,resetAt:iso(p.reset_at)});
    }
  }
  if(!meters.length)throw new MeterError('unsupported');
  return {source:'Official arkcli usage plan',plan:plans.join(' / ') || undefined,meters};
}
export class VolcengineProvider extends BaseProvider {
  id='volcengine' as const;name='火山方舟';
  async detect(){return (await Promise.all(this.accounts.map(a=>findCommand(commandPlan(a,'arkcli',[],'HOME').command)))).some(Boolean);}
  async getUsage(id:string,signal:AbortSignal){
    const a=this.account(id);
    if(a.args?.length)throw new MeterError('unsupported');
    const profile=a.arkProfile?[`--profile=${a.arkProfile}`]:[];
    // Fixed runtime environment disables implicit CLI updates on both local and SSH hosts.
    const environment={ARKCLI_NO_UPDATE_NOTIFIER:'1'};
    const invoke=async(args:string[])=>{
      const plan=await executablePlan(a,'arkcli',[...args,'--format','json',...profile],'HOME',environment);
      return runJson(plan.command,plan.args,signal,undefined,plan.env);
    };
    const auth=object(await invoke(['auth','status']));
    if(auth.logged_in!==true)throw new MeterError('unauthorized');
    return parseVolcengine(await invoke(['usage','plan',...(a.arkProduct?['--product',a.arkProduct]:[])]));
  }
}
