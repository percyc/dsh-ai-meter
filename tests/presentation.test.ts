import { test } from 'node:test';
import assert from 'node:assert/strict';
import { projectPreview } from '../src/core/presentation.js';
import { overview } from '../src/core/normalize.js';
import { configSchema } from '../src/server/config.js';
import type { QuotaSnapshot } from '../src/core/types.js';
import { parseDeepSeek } from '../src/providers/deepseek.js';
import { parseMiniMax } from '../src/providers/minimax.js';
const snapshot:QuotaSnapshot={provider:'opencode-go',account:{id:'local',name:'Local'},status:'ok',source:'fixture',fetchedAt:new Date().toISOString(),checkedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+120000).toISOString(),meters:[{id:'rolling',name:'5h',kind:'window',unit:'percent',remainingPercent:80},{id:'weekly',name:'Weekly',kind:'window',unit:'percent',remainingPercent:2}]};
test('preview metric selection, aliases, order and disappearance do not mutate collected data',()=>{
  const raw=overview([snapshot,{...snapshot,account:{id:'hidden',name:'Hidden'}}],Date.now());
  const value=projectPreview(raw,{'opencode-go':[{id:'local',presentation:{visible:true,order:0,meterIds:['missing','rolling'],labels:{missing:'旧周期',rolling:'短期'}}},{id:'hidden',presentation:{visible:false,order:0,labels:{}}}]});
  assert.equal(value.snapshots.length,1);assert.equal(value.snapshots[0].meters.length,1);assert.equal(value.snapshots[0].meters[0].name,'短期');
  assert.deepEqual(value.snapshots[0].missingMeters,['旧周期']);assert.equal(value.lowest?.remainingPercent,80);
  assert.equal(raw.lowest?.remainingPercent,2);assert.equal(raw.snapshots[0].meters[0].name,'5h');
  assert.equal(projectPreview(raw,{'opencode-go':[{id:'local',presentation:{visible:true,order:0,meterIds:[],labels:{}}},{id:'hidden',enabled:false}]}).snapshots.length,0);
});
test('channel schema rejects unsupported authentication and malformed SSH destinations',()=>{
  assert.equal(configSchema.safeParse({accounts:{codex:[{id:'a',query:{kind:'cli',location:'ssh',sshHost:'user@workstation'}}]}}).success,true);
  for(const query of [{kind:'http',auth:'api-key'},{kind:'cli',location:'ssh'},{kind:'cli',location:'ssh',sshHost:'-oProxyCommand=bad'},{kind:'cli',location:'ssh',sshHost:'host;bad'},{kind:'cli',location:'local',executable:'-c'}])assert.equal(configSchema.safeParse({accounts:{codex:[{id:'a',query}]}}).success,false);
  assert.equal(configSchema.safeParse({accounts:{deepseek:[{id:'a',query:{kind:'cli',location:'local'}}]}}).success,false);
  assert.equal(configSchema.safeParse({accounts:{deepseek:[{id:'a',query:{kind:'http',auth:'cookie'}}]}}).success,false);
});
test('metric IDs survive currency and MiniMax model order changes',()=>{
  const balances=[{currency:'USD',total_balance:'1'},{currency:'CNY',total_balance:'2'}];
  assert.deepEqual(parseDeepSeek({balance_infos:balances}).meters.map(m=>m.id).sort(),parseDeepSeek({balance_infos:[...balances].reverse()}).meters.map(m=>m.id).sort());
  const models=[{model_name:'a',current_interval_remaining_percent:20},{model_name:'b',current_interval_remaining_percent:90}];
  assert.deepEqual(parseMiniMax({model_remains:models}).meters.map(m=>m.id).sort(),parseMiniMax({model_remains:[...models].reverse()}).meters.map(m=>m.id).sort());
});
