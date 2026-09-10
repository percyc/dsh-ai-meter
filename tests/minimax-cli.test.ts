import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MiniMaxProvider } from '../src/providers/minimax.js';
import { configSchema } from '../src/server/config.js';
import { queryDescription } from '../src/core/methods.js';

test('MiniMax accepts CLI and HTTP configurations without changing the existing HTTP default',()=>{
  for(const query of [undefined,{kind:'http',auth:'api-key'},{kind:'cli',location:'local'},{kind:'cli',location:'ssh',sshHost:'workstation'}])assert.ok(configSchema.safeParse({accounts:{minimax:[{id:'test',query}]}}).success);
  assert.ok(!configSchema.safeParse({accounts:{'opencode-go':[{id:'test',query:{kind:'cli',location:'local'}}]}}).success);
  assert.match(queryDescription('minimax',{}),/GET/);
  assert.match(queryDescription('minimax',{query:{kind:'cli',location:'local'}}),/mmx quota show --non-interactive --quiet --output json/);
});
test('MiniMax local and SSH CLI use fixed JSON quota command and never resolve a DSH key',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'meter-mmx-')),previous=process.env.PATH;
  try{
    const args=['quota','show','--non-interactive','--quiet','--output','json'];
    const payload={model_remains:[{model_name:'general',current_interval_remaining_percent:73,current_weekly_status:3,current_weekly_remaining_percent:100}]};
    await writeFile(join(dir,'mmx'),`#!${process.execPath}\nrequire('node:assert/strict').deepEqual(process.argv.slice(2),${JSON.stringify(args)});process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`,{mode:0o755});
    await writeFile(join(dir,'ssh'),`#!${process.execPath}\nconst assert=require('node:assert/strict');const a=process.argv.slice(2);assert.ok(a.includes('StrictHostKeyChecking=yes'));assert.ok(a.includes('workstation'));const c=a.at(-1);for(const word of ${JSON.stringify(['mmx',...args])})assert.ok(c.includes(word));process.stdout.write(${JSON.stringify(JSON.stringify(payload))});`,{mode:0o755});
    process.env.PATH=dir;
    for(const location of ['local','ssh'] as const){
      const provider=new MiniMaxProvider([{id:'test',query:{kind:'cli',location,sshHost:location==='ssh'?'workstation':undefined}}],async()=>{throw Error('must not resolve a key');});
      assert.equal(await provider.detect(),true);
      const usage=await provider.getUsage('test',AbortSignal.timeout(2000));
      assert.equal(usage.meters[0].remainingPercent,73);assert.equal(usage.meters[1].entitlement,'unlimited');
    }
    await assert.rejects(new MiniMaxProvider([{id:'test',args:['text','chat'],query:{kind:'cli',location:'local'}}],async()=>undefined).getUsage('test',AbortSignal.timeout(2000)),/unsupported/);
  }finally{process.env.PATH=previous;await rm(dir,{recursive:true,force:true});}
});
