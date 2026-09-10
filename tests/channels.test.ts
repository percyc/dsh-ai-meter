import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { AiMeterService } from '../src/index.js';
class Settings extends Service {
  writable=true; value: any; revision=0; callback=()=>{};
  constructor(ctx:Context){super(ctx,'settings');}
  register(_ns:string,_schema:unknown,options:{base:unknown}){this.value=options.base;return {get:()=>this.value,watch:(fn:()=>void)=>{this.callback=fn;return ()=>{};}};}
  describe(){return [{ns:'dsh-ai-meter',revision:this.revision}];}
  async replace(_ns:string,value:unknown,revision:number){assert.equal(revision,this.revision);this.value=value;this.revision++;this.callback();}
}
class Credentials extends Service {
  values=new Map<string,string>([['DEEPSEEK_API_KEY','shared-secret']]);
  constructor(ctx:Context){super(ctx,'credentials');}
  async describe(ref:string){return {configured:this.values.has(ref),writable:true,source:'file'};}
  async resolve(ref:string){const value=this.values.get(ref);return value?{value,source:'file'}:undefined;}
  async set(ref:string,value:string){this.values.set(ref,value);}
}
test('channel settings persist, retain advanced server options, isolate secrets and reject stale writers',async()=>{
  const ctx=new Context();await ctx.plugin(Settings);await ctx.plugin(Credentials);
  await ctx.plugin(AiMeterService,{accounts:{'opencode-go':[],minimax:[],codex:[{id:'default',command:'custom-codex',home:'/server/home'}],antigravity:[],kimi:[],deepseek:[{id:'default'}],'302ai':[]}});
  try{
    const api=ctx.aiMeter,initial=await api.getConfiguration();
    assert.equal(initial.writable,true);assert.equal(initial.credentials.find(c=>c.provider==='deepseek')?.source,'DSH 凭据文件');
    assert.ok(!JSON.stringify(initial).includes('shared-secret'));assert.ok(initial.credentials.find(c=>c.provider==='codex')?.method?.includes('/server/home'));assert.ok(!JSON.stringify(initial.accounts).includes('/server/home'));
    const saved=await api.saveConfiguration({revision:initial.revision,accounts:{...initial.accounts,deepseek:[{id:'default',name:'Personal'},{id:'work',name:'Work'}]}});
    const settings=ctx.get('settings' as never) as unknown as Settings;
    assert.equal(settings.value.accounts.codex[0].command,'custom-codex');
    await assert.rejects(api.saveConfiguration({revision:initial.revision,accounts:{}}));
    const keyed=await api.setCredential({revision:saved.revision,provider:'deepseek',account:'work',secret:'new-test-secret'});
    const credentials=ctx.get('credentials') as unknown as Credentials;
    assert.equal(credentials.values.get('DEEPSEEK_API_KEY'),'shared-secret');
    const reference=keyed.credentials.find(c=>c.account==='work')!.reference!;
    assert.match(reference,/^DSH_AI_METER_/);assert.equal(credentials.values.get(reference),'new-test-secret');
    assert.ok(!JSON.stringify(keyed).includes('new-test-secret'));
    await assert.rejects(api.setCredential({revision:keyed.revision,provider:'codex',account:'default',secret:'bad'}));
    const disabled=await api.saveConfiguration({revision:keyed.revision,accounts:{...keyed.accounts,deepseek:[]}});
    assert.deepEqual(disabled.accounts.deepseek,[]);assert.equal(credentials.values.get(reference),'new-test-secret');
  }finally{await ctx.fiber.dispose();}
});

test('preview does not collect hidden/disabled accounts and display edits preserve host cache',async()=>{
  const ctx=new Context();await ctx.plugin(Settings);await ctx.plugin(Credentials);
  const original=globalThis.fetch;let requests=0;
  globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify({balance_infos:[{currency:'USD',total_balance:'4'}]}));};
  await ctx.plugin(AiMeterService,{accounts:{'opencode-go':[],minimax:[],codex:[],antigravity:[],kimi:[],'302ai':[],deepseek:[{id:'visible'},{id:'hidden',presentation:{visible:false}},{id:'disabled',enabled:false}]}});
  try{
    const api=ctx.aiMeter;
    assert.equal((await api.getPreview()).snapshots.length,1);assert.equal(requests,1);
    const config=await api.getConfiguration();
    await api.saveConfiguration({revision:config.revision,accounts:{...config.accounts,deepseek:config.accounts.deepseek!.map(a=>a.id==='visible'?{...a,presentation:{visible:true,order:0,meterIds:['balance-USD'],labels:{'balance-USD':'美元'}}}:a)}});
    assert.equal((await api.getPreview()).snapshots[0].meters[0].name,'美元');assert.equal(requests,1);
    assert.equal((await api.getAllUsage()).snapshots.length,2);assert.equal(requests,2);
    await api.testConnection('deepseek','visible');assert.equal(requests,3);
    let cfg=await api.getConfiguration();
    cfg=await api.setCredential({revision:cfg.revision,provider:'deepseek',account:'visible',secret:'first-test-key'});
    await api.getUsage('deepseek','visible');assert.equal(requests,4);
    await api.setCredential({revision:cfg.revision,provider:'deepseek',account:'visible',secret:'replacement-test-key'});
    await api.getUsage('deepseek','visible');assert.equal(requests,5);
  }finally{globalThis.fetch=original;await ctx.fiber.dispose();}
});

test('explicit API-key channels never borrow a default shared credential',async()=>{
  const ctx=new Context();await ctx.plugin(Settings);await ctx.plugin(Credentials);
  await ctx.plugin(AiMeterService,{accounts:{'opencode-go':[],minimax:[],codex:[],antigravity:[],kimi:[],'302ai':[],deepseek:[{id:'new',query:{kind:'http',auth:'api-key'}}]}});
  try{const value=await ctx.aiMeter.getAllUsage();assert.equal(value.snapshots[0].status,'not-configured');const cfg=await ctx.aiMeter.getConfiguration();assert.equal(cfg.credentials[0].source,'未找到凭据');assert.equal(cfg.credentials[0].canSet,true);}finally{await ctx.fiber.dispose();}
});

test('channel list omits missing implicit sources but keeps explicit accounts for repair',async()=>{
  const old=process.env.MINIMAX_API_KEY;delete process.env.MINIMAX_API_KEY;
  const ctx=new Context();await ctx.plugin(Settings);await ctx.plugin(Credentials);
  await ctx.plugin(AiMeterService,{accounts:{'opencode-go':[],codex:[],antigravity:[],kimi:[],'302ai':[]}});
  try{
    const initial=await ctx.aiMeter.getConfiguration();
    assert.deepEqual(initial.accounts.minimax,[]);
    assert.equal(initial.accounts.deepseek?.length,1);
    const saved=await ctx.aiMeter.saveConfiguration({revision:initial.revision,accounts:{...initial.accounts,minimax:[{id:'repair',query:{kind:'http',auth:'api-key'}}]}});
    assert.equal(saved.accounts.minimax?.[0]?.id,'repair');
    assert.equal(saved.credentials.find(c=>c.provider==='minimax')?.source,'未找到凭据');
  }finally{await ctx.fiber.dispose();if(old===undefined)delete process.env.MINIMAX_API_KEY;else process.env.MINIMAX_API_KEY=old;}
});

test('refresh interval round-trips and can be reset to automatic through the JSON settings boundary',async()=>{
  const ctx=new Context();await ctx.plugin(Settings);await ctx.plugin(Credentials);
  await ctx.plugin(AiMeterService,{accounts:{'opencode-go':[],minimax:[],codex:[],antigravity:[],kimi:[],deepseek:[{id:'test',refreshIntervalSeconds:600}],'302ai':[]}});
  try{
    const initial=await ctx.aiMeter.getConfiguration();assert.equal(initial.accounts.deepseek?.[0].refreshIntervalSeconds,600);
    const accounts=structuredClone(initial.accounts);delete accounts.deepseek![0].refreshIntervalSeconds;
    const saved=await ctx.aiMeter.saveConfiguration(JSON.parse(JSON.stringify({revision:initial.revision,accounts})));
    assert.equal(saved.accounts.deepseek?.[0].refreshIntervalSeconds,undefined);
    assert.equal((ctx.get('settings' as never) as unknown as Settings).value.accounts.deepseek[0].refreshIntervalSeconds,undefined);
  }finally{await ctx.fiber.dispose();}
});
