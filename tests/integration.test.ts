import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context, Service } from '@deepseek-ai/cordis';
import { AiMeterService } from '../src/index.js';
import { TYPERT } from '../src/server/manifest.js';
import { configSchema } from '../src/server/config.js';

class TestTools extends Service {
  definitions: {name:string}[]=[];
  constructor(ctx: Context) { super(ctx,'tools'); }
  register(tool:{name:string}) {this.definitions.push(tool);return ()=>{};}
}
test('real Cordis host mounts service, tool, Typert schema and disposes cleanly',async()=>{
  const ctx=new Context();
  await ctx.plugin(TestTools);
  await ctx.plugin(AiMeterService,{accounts:{'opencode-go':[],minimax:[],codex:[],antigravity:[],kimi:[],deepseek:[{id:'test',credentialEnv:'DSH_AI_METER_TEST_MISSING'}],'302ai':[]}});
  try {
    assert.ok(ctx.aiMeter);
    assert.equal((ctx.get('tools') as unknown as TestTools).definitions[0].name,'query_ai_quota');
    const value=await ctx.aiMeter.getAllUsage();
    assert.equal(value.snapshots.length,1); assert.equal(value.snapshots[0].status,'not-configured');
    for (const descriptor of TYPERT.invocations.filter(d=>!['saveConfiguration','setCredential'].includes(d.method))) {
      const api=ctx.aiMeter as unknown as Record<string,(...args:unknown[])=>Promise<unknown>>;
      const result=['getUsage','testConnection'].includes(descriptor.method) ? await api[descriptor.method]('deepseek','test') : await api[descriptor.method]();
      assert.ok(descriptor.result.schema.safeParse(result).success,descriptor.method);
    }
    assert.equal(ctx.aiMeter.typertRemote.namespace,'aiMeter');
  } finally { await ctx.fiber.dispose(); }
});
test('settings service does not require a tools service to start',async()=>{
  const ctx=new Context();
  await ctx.plugin(AiMeterService,{accounts:{'opencode-go':[],minimax:[],codex:[],antigravity:[],kimi:[],deepseek:[],'302ai':[]}});
  try {assert.deepEqual((await ctx.aiMeter.getAllUsage()).snapshots,[]);}finally{await ctx.fiber.dispose();}
});
test('configuration rejects invalid deadlines and duplicate accounts',()=>{
  assert.equal(configSchema.safeParse({timeoutMs:-1}).success,false);
  assert.equal(configSchema.safeParse({accounts:{deepseek:[{id:'a'},{id:'a'}]}}).success,false);
  assert.equal(configSchema.safeParse({accounts:{deepseek:[{id:'a',credentialEnv:'raw-key!'}]}}).success,false);
});

test('Typert descriptors allow omitted optional wire fields but require provider identity',()=>{
  const all=TYPERT.invocations.find(d=>d.method==='getAllUsage')!;
  assert.equal(all.parameters[0].acceptsUndefined,true);
  const one=TYPERT.invocations.find(d=>d.method==='getUsage')!;
  assert.equal(one.parameters[0].acceptsUndefined,undefined);
  assert.equal(one.parameters[1].acceptsUndefined,true);
});
