import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { parseVolcengine, VolcengineProvider } from '../src/providers/volcengine.js';
import { health, overview } from '../src/core/normalize.js';
import { snapshotSchema, providerIdSchema } from '../src/core/types.js';
import { configSchema } from '../src/server/config.js';
import { filterSchema } from '../src/server/manifest.js';
import { arkQuotaCommand, httpCurl } from '../src/core/methods.js';
import { commandPlan } from '../src/providers/command.js';
const fixture={viewer:{user_name:'private-viewer',account_id:'private-account'},items:[{product:'coding-plan',subscribed:true,periods:[{label:'session',percent:10,reset_at:'2099-01-01T08:00:00+08:00'},{label:'weekly',percent:25},{label:'monthly',percent:60}],updated_at:4070908800}]};
test('ARK Coding Plan uses percentage, preserves session identity and timezone, and drops viewer metadata',()=>{
  const usage=parseVolcengine(fixture);
  assert.deepEqual(usage.meters.map(m=>m.remainingPercent),[90,75,40]);
  assert.deepEqual(usage.meters.map(m=>m.id),['coding-plan-session','coding-plan-weekly','coding-plan-monthly']);
  assert.match(usage.meters[0].name,/本周期/);assert.equal(usage.meters[0].resetAt,'2099-01-01T00:00:00.000Z');
  assert.ok(usage.meters.every(m=>m.limit===undefined && m.remaining===undefined));
  assert.ok(!JSON.stringify(usage).includes('private-'));assert.ok(!JSON.stringify(usage).includes('updated_at'));
});
test('ARK Agent Plan retains AFP, zero totals stay unknown, and bucket failures do not hide successful results',()=>{
  const usage=parseVolcengine({items:[{product:'agent-plan',tier:'medium',subscribed:true,periods:[{label:'5h',used:250,total:1000,percent:25},{label:'weekly',used:0,total:0,percent:0}]},{product:'coding-plan',subscribed:false,periods:[]},{product:'agent-plan-team',error:'private-secret-upstream-detail'}]});
  assert.equal(usage.meters[0].unit,'afp');assert.equal(usage.meters[0].remaining,750);
  assert.equal(usage.meters[1].remainingPercent,undefined);assert.equal(usage.meters[1].remaining,undefined);
  assert.equal(usage.meters.length,3);assert.equal(usage.meters[2].remainingPercent,undefined);
  assert.ok(!JSON.stringify(usage).includes('private-secret'));
  const stamp=new Date().toISOString(),snapshot=snapshotSchema.parse({...usage,provider:'volcengine',account:{id:'a',name:'A'},status:'ok',fetchedAt:stamp,checkedAt:stamp,expiresAt:new Date(Date.now()+300000).toISOString()});
  assert.equal(health(snapshot),'unknown');assert.equal(overview([snapshot]).lowest?.remainingPercent,75);
});
test('ARK rejects unknown envelopes, duplicate pools/periods and distinguishes no subscription from zero remaining',()=>{
  for(const value of [{},{items:[{product:'other'}]},{items:[...fixture.items,...fixture.items]},{items:[{...fixture.items[0],periods:[fixture.items[0].periods[0],fixture.items[0].periods[0]]}]}])assert.throws(()=>parseVolcengine(value),/invalid-response/);
  assert.throws(()=>parseVolcengine({items:[]}),/unsupported/);
  assert.throws(()=>parseVolcengine({items:[{product:'coding-plan',subscribed:false,periods:[]}]}),/unsupported/);
  assert.equal(parseVolcengine({items:[{product:'coding-plan',subscribed:true,periods:[{label:'session',percent:100}]}]}).meters[0].remainingPercent,0);
});
test('ARK is CLI-only, provider filters include it, and displayed command safely quotes a profile',async()=>{
  assert.ok(configSchema.safeParse({accounts:{volcengine:[{id:'a',arkProfile:'work',arkProduct:'coding-plan',query:{kind:'cli',location:'ssh',sshHost:'workstation'}}]}}).success);
  assert.ok(!configSchema.safeParse({accounts:{volcengine:[{id:'a',arkProduct:'wrong'}]}}).success);
  assert.ok(!configSchema.safeParse({accounts:{volcengine:[{id:'a',query:{kind:'http',auth:'api-key'}}]}}).success);
  assert.deepEqual(filterSchema.parse(providerIdSchema.options),providerIdSchema.options);
  assert.equal(httpCurl('volcengine',{}),undefined);
  const profile="name ' $(echo BAD)";
  const command=arkQuotaCommand({arkProfile:profile,query:{kind:'cli',location:'local',executable:'printf'}});
  const {stdout}=await promisify(execFile)('/bin/sh',['-c',command.replace('printf usage plan --format json','printf %s')]);
  assert.ok(stdout.includes(profile));
});
test('ARK local and SSH use fixed auth and quota commands, preserve the selected profile and disable updates',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'meter-ark-')),previous=process.env.PATH;
  try{
    const profile='test-profile';
    const code=`const assert=require('node:assert/strict');const a=process.argv.slice(2);assert.equal(process.env.ARKCLI_NO_UPDATE_NOTIFIER,'1');assert.ok(a.includes('--profile=${profile}'));if(a[0]==='auth'){assert.deepEqual(a.slice(0,2),['auth','status']);process.stdout.write(JSON.stringify({logged_in:true}));}else{assert.deepEqual(a.slice(0,4),['usage','plan','--product','coding-plan']);process.stdout.write(${JSON.stringify(JSON.stringify(fixture))});}`;
    await writeFile(join(dir,'arkcli'),`#!${process.execPath}\n${code}`,{mode:0o755});
    await writeFile(join(dir,'ssh'),`#!${process.execPath}\nconst a=process.argv.slice(2);require('node:assert/strict').ok(a.includes('StrictHostKeyChecking=yes'));require('node:child_process').execFile('/bin/sh',['-c',a.at(-1)],{env:process.env},(err,out)=>{if(err)process.exit(1);process.stdout.write(out);});`,{mode:0o755});
    process.env.PATH=dir+':/usr/bin:/bin';
    for(const location of ['local','ssh'] as const){
      const provider=new VolcengineProvider([{id:'a',arkProfile:profile,arkProduct:'coding-plan',query:{kind:'cli',location,sshHost:location==='ssh'?'workstation':undefined}}],async()=>{throw Error('must not resolve DSH keys');});
      assert.ok(await provider.detect());assert.equal((await provider.getUsage('a',AbortSignal.timeout(3000))).meters[0].remainingPercent,90);
    }
    await writeFile(join(dir,'arkcli'),`#!${process.execPath}\nif(process.argv[2]!=='auth')process.exit(7);process.stdout.write(JSON.stringify({logged_in:false}));`,{mode:0o755});
    const provider=new VolcengineProvider([{id:'a'}],async()=>undefined);
    await assert.rejects(provider.getUsage('a',AbortSignal.timeout(2000)),/unauthorized/);
    const remote=commandPlan({id:'a',query:{kind:'cli',location:'ssh',sshHost:'workstation'}},'arkcli',['usage','plan'],'HOME',{ARKCLI_NO_UPDATE_NOTIFIER:'1'});
    assert.ok(remote.args.at(-1)!.includes('ARKCLI_NO_UPDATE_NOTIFIER=1'));
  }finally{process.env.PATH=previous;await rm(dir,{recursive:true,force:true});}
});
