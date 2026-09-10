import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MeterRegistry } from '../src/core/registry.js';
import { MeterError } from '../src/core/errors.js';
import { health, overview } from '../src/core/normalize.js';
import type { ProviderUsage, QuotaProvider } from '../src/core/types.js';
const usage = (remainingPercent = 80): ProviderUsage => ({source:'fixture',meters:[{id:'weekly',name:'Weekly',kind:'window',unit:'percent',remainingPercent}]});
const fake = (getUsage: QuotaProvider['getUsage'], id: QuotaProvider['id'] = 'codex'): QuotaProvider => ({id,name:id,detect:async()=>true,getAccounts:async()=>[{id:'a',name:'A'},{id:'b',name:'B'}],getUsage});
const options = {cacheTtlMs:1000,timeoutMs:100,lowQuotaPercent:10};
test('per-account caching, simultaneous force refresh deduplication, TTL and immutable returns',async()=>{
  let now = 0, calls = 0;
  const r = new MeterRegistry(options,()=>now).register(fake(async()=>{calls++;await new Promise(resolve=>setTimeout(resolve,5));return usage();}));
  const [a,b] = await Promise.all([r.getUsage('codex','a'),r.getUsage('codex','a',true)]);
  assert.equal(calls,1); a.meters[0].remainingPercent=0;
  assert.equal(b.meters[0].remainingPercent,80);
  await r.getUsage('codex','a'); assert.equal(calls,1);
  await r.getUsage('codex','b'); assert.equal(calls,2);
  now=1001;await r.getUsage('codex','a');assert.equal(calls,3);
});
test('failed refresh keeps last success timestamp, marks stale, redacts raw errors and blocks routing',async()=>{
  let fail=false,now=100;
  const r=new MeterRegistry(options,()=>now).register(fake(async()=>{if(fail)throw new Error('Bearer sk-secret');return usage();}));
  const first=await r.getUsage('codex','a');fail=true;now=200;
  const result=await r.getUsage('codex','a',true);
  assert.equal(result.status,'stale');assert.equal(result.fetchedAt,first.fetchedAt);assert.notEqual(result.checkedAt,first.checkedAt);
  assert.equal(result.error,'upstream');assert.ok(!JSON.stringify(result).includes('sk-secret'));
  assert.deepEqual(await r.getAvailableProviders(),[]);
});
test('timeout aborts hanging provider while other accounts/providers return',async()=>{
  let aborted=false;
  const r=new MeterRegistry({...options,timeoutMs:20}).register(fake(async(_a,signal)=>new Promise(()=>signal.addEventListener('abort',()=>{aborted=true;}))));
  r.register(fake(async()=>usage(),'minimax'));
  const result=await r.getAllUsage();
  assert.ok(aborted);assert.equal(result.snapshots.filter(s=>s.status==='ok').length,2);
  assert.equal(result.snapshots[0].error,'timeout');r.dispose();
});
test('health distinguishes unknown, low, exhaustion and fresh balance without fake percentage',async()=>{
  let value=usage(); const r=new MeterRegistry(options).register(fake(async()=>value));
  let s=await r.getUsage('codex','a');assert.equal(health(s),'healthy');
  value=usage(9);s=await r.getUsage('codex','a',true);assert.equal(health(s),'low');
  value=usage(0);s=await r.getUsage('codex','a',true);assert.equal(health(s),'exhausted');
  value={source:'balance',meters:[{id:'balance',name:'USD',kind:'balance',unit:'money',remaining:18,currency:'USD'}]};
  s=await r.getUsage('codex','a',true);assert.equal(health(s),'healthy');assert.equal(overview([s]).lowest,null);
  delete s.meters[0].remaining;assert.equal(health(s),'unknown');
});
test('reset expiry and TTL expiry block route readiness, not automatically refill',async()=>{
  let now=1000; const r=new MeterRegistry(options,()=>now).register(fake(async()=>({...usage(),meters:[{...usage().meters[0],resetAt:new Date(1500).toISOString()}]})));
  const s=await r.getUsage('codex','a');now=1600;
  assert.equal(health(s,10,now),'unknown');assert.equal(overview([s],now).lowest,null);
  now=2100;assert.equal(health(s,10,now),'stale');
});
test('filter queries only selected providers; threshold and status semantics stay consistent',async()=>{
  let unwanted=0;
  const r=new MeterRegistry({...options,lowQuotaPercent:30}).register(fake(async()=>usage(20)));
  r.register(fake(async()=>{unwanted++;return usage();},'minimax'));
  const result=await r.getAllUsage(['codex']);assert.equal(unwanted,0);assert.equal(result.snapshots.length,2);assert.equal(result.lowQuotaPercent,30);
  assert.deepEqual(await r.getAvailableProviders(['codex']),[]);
  await assert.rejects(r.getUsage('codex','nonexistent'),/not-configured/);
});
test('missing credentials do not break other provider queries',async()=>{
  const r=new MeterRegistry(options).register(fake(async()=>{throw new MeterError('not-configured');}));
  r.register(fake(async()=>usage(),'minimax'));
  const result=await r.getAllUsage(); assert.equal(result.snapshots[0].status,'not-configured');assert.equal(result.snapshots[2].status,'ok');
});
test('provider metadata failure stays isolated and unknown account does not fall through',async()=>{
  const broken=fake(async()=>usage());broken.getAccounts=async()=>{throw new Error('secret-file-detail');};
  const r=new MeterRegistry(options).register(broken).register(fake(async()=>usage(),'minimax'));
  const result=await r.getAllUsage();
  assert.equal(result.snapshots[0].status,'error');assert.equal(result.snapshots[0].error,'upstream');
  assert.equal(result.snapshots[1].status,'ok');assert.ok(!JSON.stringify(result).includes('secret-file-detail'));
});
test('disposal aborts active requests and rejects new collection without launching providers',async()=>{
  let started=0;let aborted=false;
  const r=new MeterRegistry(options).register(fake(async(_id,signal)=>{started++;return new Promise(()=>signal.addEventListener('abort',()=>{aborted=true;}));}));
  const pending=r.getUsage('codex','a');
  await new Promise(resolve=>setTimeout(resolve,5));r.dispose();
  assert.equal((await pending).error,'timeout');assert.ok(aborted);
  await r.getUsage('codex','b');assert.equal(started,1);
});

test('unlimited quota stays healthy; unsupported pools neither exhaust nor enable routing',async()=>{
  let value:ProviderUsage={source:'fixture',meters:[{id:'week',name:'Weekly',kind:'window',unit:'percent',entitlement:'unlimited',remainingPercent:100},{id:'video',name:'Video',kind:'window',unit:'percent',entitlement:'unsupported',remaining:0}]};
  const r=new MeterRegistry(options).register(fake(async()=>value));
  const s=await r.getUsage('codex','a');
  assert.equal(health(s),'healthy');assert.equal(overview([s]).lowest,null);
  assert.equal(s.meters[0].remainingPercent,undefined);assert.equal(s.meters[1].remaining,undefined);
  assert.ok((await r.getAvailableProviders()).length>0);
  value={...value,meters:[value.meters[1]]};
  assert.equal(health(await r.getUsage('codex','a',true)),'unsupported');
  await r.getUsage('codex','b',true);
  assert.deepEqual(await r.getAvailableProviders(),[]);
});

test('per-channel intervals and failure backoff are demand-driven and manual refresh bypasses them',async()=>{
  let now=0,calls=0,fail=false;
  const r=new MeterRegistry(options,()=>now,(_p,a)=>a==='a'?5000:2000).register(fake(async()=>{calls++;if(fail)throw new MeterError('network');return usage();}));
  const a=await r.getUsage('codex','a');assert.equal(Date.parse(a.expiresAt),5000);assert.equal(Date.parse(a.nextCheckAt!),5000);
  now=2001;await r.getUsage('codex','a');assert.equal(calls,1);
  fail=true;now=5001;let s=await r.getUsage('codex','a');assert.equal(Date.parse(s.nextCheckAt!),10001);assert.equal(s.status,'stale');
  now=10002;s=await r.getUsage('codex','a');assert.equal(Date.parse(s.nextCheckAt!),20002);
  now=15000;await r.getUsage('codex','a');assert.equal(calls,3);
  fail=false;s=await r.getUsage('codex','a',true);assert.equal(s.status,'ok');assert.equal(calls,4);
  now=100000;await new Promise(resolve=>setTimeout(resolve,10));assert.equal(calls,4);
});
test('UI gets cached rows immediately while slow accounts finish independently, with bounded concurrency',async()=>{
  let started=0,running=0,maximum=0;const releases:(()=>void)[]=[];
  const provider=fake(async()=>{started++;running++;maximum=Math.max(maximum,running);await new Promise<void>(resolve=>releases.push(resolve));running--;return usage();});
  provider.getAccounts=async()=>Array.from({length:5},(_,i)=>({id:String(i),name:String(i)}));
  const r=new MeterRegistry({...options,timeoutMs:2000}).register(provider);
  const view=await r.getUsageView();assert.equal(view.snapshots.length,5);assert.ok(view.snapshots.every(s=>s.pending));
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(started,3);
  releases.shift()!();await new Promise(resolve=>setTimeout(resolve,10));
  const partial=await r.getUsageView();assert.equal(partial.snapshots.filter(s=>!s.pending).length,1);assert.equal(started,4);
  while(releases.length){releases.shift()!();await new Promise(resolve=>setTimeout(resolve,5));}
  const complete=await r.getUsageView();assert.ok(complete.snapshots.every(s=>!s.pending));assert.equal(maximum,3);assert.equal(started,5);
  r.dispose();
});

test('reading UI job status cannot start collection, even after another channel expires',async()=>{
  let now=0,calls=0;
  const r=new MeterRegistry(options,()=>now).register(fake(async()=>{calls++;return usage();}));
  const empty=await r.getUsageView(false,undefined,false);assert.equal(calls,0);assert.ok(empty.snapshots.every(s=>!s.pending));
  await r.getUsage('codex','a');assert.equal(calls,1);now=2000;
  const old=await r.getUsageView(false,undefined,false);assert.equal(calls,1);assert.equal(old.snapshots[0].meters[0].remainingPercent,80);
  old.snapshots[0].meters[0].remainingPercent=0;
  assert.equal((await r.getUsageView(false,undefined,false)).snapshots[0].meters[0].remainingPercent,80);
});
