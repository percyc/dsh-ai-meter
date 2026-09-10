import type { Context } from '@deepseek-ai/cordis';
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { MeterRegistry } from './core/registry.js';
import { providerIdSchema, type ProviderId } from './core/types.js';
import { createProviders } from './providers/index.js';
import { effectiveQuery } from './core/channel.js';
import { Config, configSchema, type MeterConfig } from './server/config.js';
import { filterSchema } from './server/manifest.js';
import { previewIncluded, projectPreview } from './core/presentation.js';
import { ChannelSettings } from './server/settings.js';
import type { ChannelSave, SecretSave } from './server/channels.js';
export { Config };
export const name = 'dsh-ai-meter';
declare module '@deepseek-ai/cordis' { interface Context { aiMeter: AiMeterService } }

export class AiMeterService extends TypertRemoteService {
  static Config = Config;
  private registry: MeterRegistry;
  private channels: ChannelSettings;
  private localDiscovery:()=>Promise<ProviderId[]>;
  constructor(ctx: Context, input: unknown = {}) {
    super(ctx, 'aiMeter');
    const config = configSchema.parse(input);
    const makeRegistry=(c:MeterConfig)=>new MeterRegistry(c,Date.now,(provider,account)=>{const row=c.accounts[provider]?.find(a=>a.id===account);return row?.refreshIntervalSeconds ? row.refreshIntervalSeconds*1000 : effectiveQuery(provider,row ?? {}).kind==='cli'?300000:c.cacheTtlMs;});
    this.registry = makeRegistry(config);
    const resolve = async (name: string) => {
      const credentials = ctx.get('credentials');
      if (credentials) {
        try { const c = await credentials.resolve(credentialRef(name)); if (c?.value) return c.value; }
        catch { /* environment fallback */ }
      }
      return process.env[name] || undefined;
    };
    this.localDiscovery=async()=>{
      const probe=new MeterRegistry(config);
      try{for(const provider of createProviders({},resolve))probe.register(provider);return (await probe.listProviders()).filter(p=>p.detected).map(p=>p.id);}
      finally{probe.dispose();}
    };
    for (const provider of createProviders(config.accounts, resolve)) this.registry.register(provider);
    const signature=(value:MeterConfig)=>JSON.stringify({...value,accounts:Object.fromEntries(Object.entries(value.accounts).map(([provider,rows])=>[provider,rows?.map(({presentation,identity,...row})=>row)]))},(_key,item)=>item && typeof item==='object' && !Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
    let activeConfig = signature(config);
    this.channels = new ChannelSettings(ctx, config, (next, force = false) => {
      if (!force && signature(next) === activeConfig) return;
      activeConfig = signature(next);
      this.registry.dispose();
      this.registry = makeRegistry(next);
      for (const provider of createProviders(next.accounts, resolve)) this.registry.register(provider);
    });
    ctx.effect(() => () => this.registry.dispose());
    ctx.inject(['tools'], scope => {
      scope.tools.register(defineTool({
        name:'query_ai_quota',
        description:'Read AI provider quota, usage and balances. Values retain their units and account/window scopes. Unknown or stale values are not available quota. This does not select a model or perform inference.',
        parameters:{providers:{type:'array', items:{type:'string', enum:providerIdSchema.options}, description:'Optional provider filter.'}},
        output:{schema:{type:'object', additionalProperties:true}, render:(_args, value) => [{type:'text', text:JSON.stringify(value)}]},
        timeoutMs:config.timeoutMs + 5000,
        execute:args => this.getAllUsage(args.providers as ProviderId[] | undefined),
      }));
    });
  }
  discoverLocal() { return this.localDiscovery(); }
  async getPreview() {
    const accounts=this.channels.current().accounts;
    return projectPreview(await this.registry.getAllUsage(undefined,false,(provider,account)=>previewIncluded(accounts,provider,account)),accounts);
  }
  async getUsageView(preview:boolean,force:boolean,collect:boolean) {
    const accounts=this.channels.current().accounts;
    const value=await this.registry.getUsageView(force,preview?(provider,account)=>previewIncluded(accounts,provider,account):undefined,collect);
    return preview?projectPreview(value,accounts):value;
  }
  getConfiguration() { return this.channels.get(); }
  saveConfiguration(input: ChannelSave) { return this.channels.save(input); }
  setCredential(input: SecretSave) { return this.channels.setSecret(input); }
  listProviders() { return this.registry.listProviders(); }
  testConnection(provider:ProviderId,account:string) { return this.registry.getUsage(providerIdSchema.parse(provider), account, true); }
  getUsage(provider: ProviderId, account?: string) { return this.registry.getUsage(providerIdSchema.parse(provider), account); }
  getAllUsage(filter?: ProviderId[]) { return this.registry.getAllUsage(filterSchema.parse(filter)); }
  refresh(filter?: ProviderId[]) { return this.registry.refresh(filterSchema.parse(filter)); }
  getHealth(filter?: ProviderId[]) { return this.registry.getHealth(filterSchema.parse(filter)); }
  getAvailableProviders(filter?: ProviderId[]) { return this.registry.getAvailableProviders(filterSchema.parse(filter)); }
}
export default AiMeterService;
