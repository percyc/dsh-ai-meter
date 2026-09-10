import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { requestJson, runText, MAX_BYTES } from '../src/providers/shared.js';
import { codexRateLimits, parseCodex } from '../src/providers/codex.js';

test('HTTP mapping, bounded streamed responses, secrets never in errors',async()=>{
  const original=globalThis.fetch;
  try {
    for (const [status,code] of [[401,'unauthorized'],[403,'unauthorized'],[429,'rate-limited'],[500,'upstream']] as const) {
      globalThis.fetch=async()=>new Response('sk-secret upstream',{status});
      await assert.rejects(requestJson('https://example.invalid','sk-secret',new AbortController().signal),{message:code});
    }
    globalThis.fetch=async(_url,options)=>{assert.equal(options?.redirect,'error');return new Response('{"ok":true}');};
    assert.deepEqual(await requestJson('https://example.invalid','secret',new AbortController().signal),{ok:true});
    globalThis.fetch=async()=>new Response('x'.repeat(MAX_BYTES+1));
    await assert.rejects(requestJson('https://example.invalid','secret',new AbortController().signal),/invalid-response/);
    globalThis.fetch=async()=>new Response('<html>Sign in</html>');
    await assert.rejects(requestJson('https://example.invalid','secret',new AbortController().signal),/invalid-response/);
  } finally {globalThis.fetch=original;}
});
test('Codex performs initialize/initialized/read over real child process, ignores notifications',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'ai-meter-'));
  try {
    const script=join(dir,'fake.cjs');
    await writeFile(script,`const rl=require('node:readline').createInterface({input:process.stdin});let ready=false;rl.on('line',line=>{const m=JSON.parse(line);if(m.method==='initialize')process.stdout.write(JSON.stringify({id:m.id,result:{}})+'\\n');if(m.method==='initialized')ready=true;if(m.method==='account/rateLimits/read'){process.stdout.write(JSON.stringify({method:'notice'})+'\\n');process.stdout.write(JSON.stringify({id:m.id,result:ready?{rateLimits:{primary:{usedPercent:25,windowDurationMins:300}}}:null})+'\\n');}});`);
    const result=await codexRateLimits(process.execPath,[script],AbortSignal.timeout(2000));
    assert.equal(parseCodex(result).meters[0].remainingPercent,75);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test('Codex timeout and early CLI exit settle with classified error',async()=>{
  await assert.rejects(codexRateLimits(process.execPath,['-e','setInterval(()=>{},1000)','--'],AbortSignal.timeout(100)),/timeout/);
  await assert.rejects(codexRateLimits(process.execPath,['-e','process.exit(1)','--'],AbortSignal.timeout(1000)),/command-failed/);
  await assert.rejects(codexRateLimits('/definitely/missing/codex',[],AbortSignal.timeout(1000)),/not-installed/);
});
test('CLI text bridge uses argv without shell and hides stderr',async()=>{
  const result=await runText(process.execPath,['-e','process.stdout.write(JSON.stringify({value:process.argv[1]}))','--','$(echo unsafe)'],AbortSignal.timeout(2000));
  assert.equal(result,JSON.stringify({value:'$(echo unsafe)'}));
  await assert.rejects(runText(process.execPath,['-e','process.stderr.write("sk-secret");process.exit(1)'],AbortSignal.timeout(2000)),{message:'command-failed'});
});

test('AGY rejects old bridge and arbitrary prompt arguments without executing them',async()=>{
  const {AntigravityProvider}=await import('../src/providers/antigravity.js');
  for(const account of [{id:'old',command:'agy-quota'},{id:'old',command:'node',args:['old-bridge.js']},{id:'old',args:['--print','run a task']}]){
    await assert.rejects(new AntigravityProvider([account],async()=>undefined).getUsage('old',AbortSignal.timeout(1000)),{message:'unsupported'});
  }
});
