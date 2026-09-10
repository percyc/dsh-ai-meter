import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOpenCode } from '../src/providers/opencode-go.js';
import { parseMiniMax } from '../src/providers/minimax.js';
import { parseCodex } from '../src/providers/codex.js';
import { parseAntigravity } from '../src/providers/antigravity.js';
import { parseKimi } from '../src/providers/kimi.js';
import { parseDeepSeek } from '../src/providers/deepseek.js';
import { parse302 } from '../src/providers/302ai.js';
import { numeric, normalizeMeter, iso } from '../src/core/normalize.js';

const reset = '2099-01-01T00:00:00.000Z';
test('OpenCode percent is used; distinct windows and reset preserved', () => {
  const {meters} = parseOpenCode({usage:{rolling:{percent:28,resetsAt:reset},weekly:{percent:'57'},monthly:{percent:19}}});
  assert.deepEqual(meters.map(m => m.remainingPercent),[72,43,81]);
  assert.equal(meters[0].resetAt,reset);
  assert.equal(meters[0].limit,undefined);
});
test('missing values are unknown, not zero or full quota', () => {
  for (const v of [null, undefined, '', ' ', false, [], {}, 'NaN', Infinity]) assert.equal(numeric(v),undefined);
  assert.equal(parseOpenCode({rolling:{percent:null}}).meters[0].remainingPercent,undefined);
  assert.equal(parseOpenCode({rolling:{percent:-1}}).meters[0].remainingPercent,undefined);
  assert.equal(iso('garbage'),undefined);
  assert.equal(iso(1e30),undefined);
});
test('MiniMax Token Plan authoritative percent overrides meaningless counters, retains boost', () => {
  const {meters} = parseMiniMax({base_resp:{status_code:0},model_remains:[{model_name:'general',current_interval_total_count:0,current_interval_usage_count:0,current_interval_remaining_percent:67,current_weekly_remaining_percent:140,end_time:4070908800000}]});
  assert.deepEqual(meters.map(m => m.remainingPercent),[67,140]);
  assert.equal(meters[0].limit,undefined);
  assert.equal(meters[0].resetAt,reset);
});
test('legacy Coding Plan usage_count means remaining requests', () => {
  const {meters} = parseMiniMax({model_remains:[{model_name:'M2',current_interval_total_count:5000,current_interval_usage_count:1243}]},true);
  const m = normalizeMeter(meters[0]);
  assert.equal(m.remaining,1243); assert.equal(m.unit,'requests'); assert.equal(m.remainingPercent,24.86);
});
test('Codex multi-bucket data takes precedence over legacy duplicate and preserves credits', () => {
  const primary = {usedPercent:45,windowDurationMins:300,resetsAt:4070908800};
  const {meters,plan} = parseCodex({rateLimits:{primary},rateLimitsByLimitId:{codex:{planType:'plus',primary,secondary:{usedPercent:16,windowDurationMins:10080},credits:{balance:'15.2'}},other:{primary:{usedPercent:9,windowDurationMins:60}}}});
  assert.equal(meters.length,4); assert.equal(plan,'plus'); assert.equal(meters[0].remainingPercent,55);
  assert.equal(meters[0].resetAt,reset); assert.equal(meters[2].kind,'credits');
  assert.match(meters[3].name,/60m/);
});
test('official AGY text keeps model groups and quota windows distinct', () => {
  const {meters}=parseAntigravity(`Gemini Models\tWeekly Limit Remaining\t92%\t${reset}\nGemini Models\tFive Hour Limit Remaining\t100%\t${reset}\nClaude and GPT models\tWeekly Limit Remaining\t0%\t${reset}\nClaude and GPT models\tFive Hour Limit Remaining\t61.5%\t${reset}\n`);
  assert.deepEqual(meters.map(m=>m.id),['gemini-weekly','gemini-5h','claude-gpt-weekly','claude-gpt-5h']);
  assert.deepEqual(meters.map(m=>m.remainingPercent),[92,100,0,61.5]);
  assert.equal(meters[0].resetAt,reset);
});
test('official AGY fails closed on unknown format, duplicates, missing data and legacy JSON', () => {
  for(const value of ['',{},'login required',`Gemini Models\tWeekly Limit Remaining\t101%\t${reset}`,`Gemini Models\tWeekly Limit Remaining\t-1%\t${reset}`,`Gemini Models\tWeekly Limit Remaining\t92%\tunknown`,{models:[{remaining_fraction:.9}]},`Gemini Models\tWeekly Limit Remaining\t92%\t${reset}\nGemini Models\tWeekly Limit Remaining\t92%\t${reset}`])assert.throws(()=>parseAntigravity(value));
});
test('Kimi derives quota from remaining after reset without assuming requests', () => {
  const {meters} = parseKimi({limits:[{window:{duration:300,timeUnit:'TIME_UNIT_MINUTE'},detail:{limit:'100',remaining:'75',resetTime:reset}}],usage:{limit:100,used:0}});
  assert.equal(meters[0].name,'5h'); assert.equal(normalizeMeter(meters[0]).remainingPercent,75);
  assert.equal(normalizeMeter(meters[1]).remainingPercent,100); assert.equal(meters[0].unit,'unknown');
});
test('balances retain currencies and negative debt; 302 does not assume USD', () => {
  const {meters} = parseDeepSeek({balance_infos:[{currency:'USD',total_balance:'18.42'},{currency:'CNY',total_balance:'-1.20'}]});
  assert.equal(meters[0].remaining,18.42); assert.equal(meters[1].remaining,-1.2);
  assert.equal(normalizeMeter(meters[0]).remainingPercent,undefined);
  assert.equal(parse302({data:{balance:'12.34'}}).meters[0].currency,undefined);
});
test('unexpected payloads and business errors fail explicitly', () => {
  for (const parse of [parseOpenCode,parseMiniMax,parseCodex,parseAntigravity,parseKimi,parseDeepSeek,parse302]) assert.throws(() => parse({}));
  assert.throws(() => parseMiniMax({base_resp:{status_code:1004},model_remains:[]}),/unauthorized/);
  assert.throws(() => parseDeepSeek({balance_infos:[{total_balance:null}]}),/invalid-response/);
});

test('MiniMax official status rules distinguish unlimited weekly quota from a pool not in plan', () => {
  const base={current_interval_total_count:0,current_weekly_total_count:0,current_interval_usage_count:0,current_weekly_usage_count:0,current_interval_remaining_percent:92,current_weekly_remaining_percent:100,current_weekly_status:3,start_time:4070890800000,end_time:4070908800000,weekly_end_time:4070908800000};
  for(const legacy of [false,true]){
    const {meters}=parseMiniMax({model_remains:[{...base,model_name:'general',current_interval_status:1},{...base,model_name:'video',current_interval_status:3,start_time:4070822400000}]},legacy);
    assert.equal(meters[0].remainingPercent,92);
    assert.equal(meters[0].name,'general · 5h');
    assert.equal(meters[1].entitlement,'unlimited');
    assert.equal(meters[2].name,'video · 24h');
    assert.deepEqual(meters.slice(2).map(m=>m.entitlement),['unsupported','unsupported']);
    for(const m of meters.slice(1)){
      assert.equal(m.remainingPercent,undefined);assert.equal(m.remaining,undefined);assert.equal(m.limit,undefined);assert.equal(m.resetAt,undefined);
    }
  }
  // status=3 alone (or missing totals) does not establish a pool exclusion.
  const {meters}=parseMiniMax({model_remains:[{current_interval_status:3,current_interval_remaining_percent:100,current_weekly_status:3,current_weekly_remaining_percent:100}]});
  assert.equal(meters[0].entitlement,undefined);assert.equal(meters[1].entitlement,'unlimited');
});
test('MiniMax weekly boost is permille and missing interval duration is not invented',()=>{
  const {meters}=parseMiniMax({model_remains:[{model_name:'general',current_interval_remaining_percent:60,current_weekly_remaining_percent:80,weekly_boost_permille:1500}]});
  assert.equal(meters[0].name,'general · 当前周期');
  assert.deepEqual(meters.map(m=>m.remainingPercent),[60,120]);
});

test('Codex zero extra credits do not imply an exhausted subscription',()=>{
  const usage=parseCodex({rateLimits:{primary:{usedPercent:20},secondary:{usedPercent:40},credits:{balance:'0',hasCredits:false,unlimited:false}}});
  assert.equal(usage.meters.at(-1)?.remaining,0);
  assert.match(usage.meters.at(-1)!.name,/额外 Credits/);
});
