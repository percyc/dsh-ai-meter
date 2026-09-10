import type { Context } from '@deepseek-ai/cordis';
import { credentialRef } from '@deepseek-ai/dsh-credentials';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Config, configSchema, type MeterConfig } from './config.js';
import { channelSaveSchema, secretSaveSchema, credentialNames, type ChannelConfiguration, type ChannelSave, type SecretSave } from './channels.js';
import { queryDescription } from '../core/methods.js';
import { effectiveQuery } from '../core/channel.js';
import { providerIdSchema } from '../core/types.js';
import { accountHome, readJson, object, findCommand } from '../providers/shared.js';
// Structural bridge to the host settings capability, also works without it in standalone hosts.
interface Scope {get():unknown;watch(fn:()=>void):()=>void}
interface Settings {writable:boolean;register(ns:string,schema:unknown,options:unknown):Scope;describe():{ns:string;revision:number}[];replace(ns:string,value:object,revision:number):Promise<void>}
export class ChannelSettings {
  private scope?:Scope;
  private settings?:Settings;
  private queue:Promise<unknown>=Promise.resolve();
  constructor(private ctx:Context,private base:MeterConfig,private changed:(config:MeterConfig,force?:boolean)=>void) {
    ctx.inject(['settings' as never], scope=>{
      const settings=scope.get('settings' as never) as unknown as Settings;
      this.settings=settings;
      this.scope=settings.register('dsh-ai-meter',Config,{base,applies:'live',validate:(v:unknown)=>configSchema.parse(v)});
      changed(this.current());
      scope.effect(()=>this.scope!.watch(()=>changed(this.current())));
      scope.effect(()=>()=>{this.settings=undefined;this.scope=undefined;changed(base);});
    });
  }
  current(){return configSchema.parse(this.scope?.get() ?? this.base);}
  private revision(){return this.settings?.describe().find(d=>d.ns==='dsh-ai-meter')?.revision ?? 0;}
  private serial<T>(work:()=>Promise<T>):Promise<T>{const next=this.queue.then(work);this.queue=next.catch(()=>{});return next;}
  async get():Promise<ChannelConfiguration>{
    const revision=this.revision(),config=this.current(),credentials=this.ctx.get('credentials');
    const accounts:ChannelConfiguration['accounts']={},info:ChannelConfiguration['credentials']=[];
    for(const provider of providerIdSchema.options){
      const rows=config.accounts[provider] ?? [{id:'default',name:'Default'}];
      accounts[provider]=rows.map(({id,name,region,planType,enabled,identity,query,presentation,refreshIntervalSeconds})=>({id,name,region,planType,enabled,identity,query,presentation,refreshIntervalSeconds}));
      for(const row of rows){
        const query=effectiveQuery(provider,row);
        const explicitMissing=query.kind==='http' && query.auth==='api-key' && !row.credentialEnv;
        const ref=query.kind==='cli' || explicitMissing ? undefined : row.credentialEnv ?? credentialNames[provider];
        let source=provider==='codex' ? 'Codex CLI 自有登录（由 CLI 管理）' : provider==='antigravity' ? '官方 agy CLI 自有登录（插件不读取凭据）' : '未找到凭据';
        if(provider==='minimax' && query.kind==='cli')source='官方 mmx CLI 自有登录与配置（插件不读取凭据）';
        if(query.kind==='cli' && query.location==='ssh')source=`SSH ${query.sshHost}：远端 CLI 自有登录（未读取本机登录）`;
        if(provider==='antigravity' && query.kind==='cli' && query.location==='local' && !await findCommand(query.executable ?? row.command ?? 'agy')){
          source='未找到配置的官方 agy 命令，请检查可执行文件路径';
        }
        if(ref){
          const detail=await credentials?.describe(credentialRef(ref));
          if(detail?.configured)source=({env:'DSH 进程环境变量',file:'DSH 凭据文件', 'project-env':'DSH 启动目录 .env','user-env':'DSH home .env'} as Record<string,string>)[detail.source ?? ''] ?? 'DSH 凭据服务';
          else if(process.env[ref])source='DSH 进程环境变量';
          else if(!row.credentialEnv && query.kind==='http' && query.auth==='auto' && provider==='opencode-go'){
            const dir=row.home ? join(row.home,'.local','share') : process.env.XDG_DATA_HOME ?? join(accountHome(row),'.local','share');
            const entry=object((await readJson(join(dir,'opencode','auth.json')))['opencode-go']);
            if(entry.type==='api' && typeof entry.key==='string' && entry.key)source='OpenCode 本地 auth.json';
          }else if(!row.credentialEnv && query.kind==='http' && query.auth==='auto' && provider==='kimi'){
            for(const dir of ['.kimi-code','.kimi']){const data=await readJson(join(accountHome(row),dir,'credentials','kimi-code.json'));if(typeof data.access_token==='string' && data.access_token){source=`Kimi 本地 ${dir}/credentials/kimi-code.json`;break;}}
          }
        }
        // Legacy implicit accounts are only listed when there is an existing source.
        // Explicitly saved channels stay editable even when their credentials disappear.
        if(!config.accounts[provider]){
          const available=query.kind==='cli' ? !!await findCommand(query.executable ?? row.command ?? (provider==='codex'?'codex':'agy')) : source!=='未找到凭据';
          if(!available){accounts[provider]=[];continue;}
        }
        info.push({provider,account:row.id,reference:ref,source,method:queryDescription(provider,row),canSet:query.kind==='http' && !!credentials && !!this.settings?.writable});
      }
    }
    return {revision,writable:!!this.settings?.writable,accounts,credentials:info};
  }
  save(input:ChannelSave){return this.serial(async()=>{
    const value=channelSaveSchema.parse(input),config=this.current();
    if(!this.settings?.writable)throw Error('Settings unavailable');
    if(value.revision!==this.revision())throw Error('Configuration changed; reload before saving');
    const accounts=Object.fromEntries(providerIdSchema.options.map(id=>[id,(value.accounts[id] ?? []).map(row=>({...config.accounts[id]?.find(old=>old.id===row.id),...row,refreshIntervalSeconds:row.refreshIntervalSeconds}))]));
    await this.settings.replace('dsh-ai-meter',{...config,accounts},value.revision);
    this.changed(this.current());return this.get();
  });}
  setSecret(input:SecretSave){return this.serial(async()=>{
    const value=secretSaveSchema.parse(input),config=this.current(),credentials=this.ctx.get('credentials');
    if(!this.settings?.writable || !credentials || !credentialNames[value.provider])throw Error('Credential editing unavailable');
    if(value.revision!==this.revision())throw Error('Configuration changed; reload before saving');
    const rows=config.accounts[value.provider] ?? [{id:'default',name:'Default'}];
    const row=rows.find(r=>r.id===value.account);
    if(!row)throw Error('Save account first');
    if(effectiveQuery(value.provider,row).kind!=='http')throw Error('CLI owns its authentication');
    // Dedicated reference: never overwrite DSH's shared provider key or CLI login files.
    const ref='DSH_AI_METER_'+createHash('sha256').update(JSON.stringify([value.provider,value.account])).digest('hex').toUpperCase();
    try{await credentials.set(credentialRef(ref),value.secret);}catch{throw Error('Credential write failed');}
    const accounts={...config.accounts,[value.provider]:rows.map(r=>r.id===value.account?{...r,credentialEnv:ref,query:{kind:'http' as const,auth:'api-key' as const}}:r)};
    await this.settings.replace('dsh-ai-meter',{...config,accounts},value.revision);
    this.changed(this.current(),true);return this.get();
  });}
}
