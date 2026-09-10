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
