import React, { useCallback, useEffect, useRef, useState } from 'react';
import type { Overview, ProviderId, QuotaMeter, QuotaSnapshot } from '../core/types.js';
import { Channels, type ChannelActions } from './channels.js';
import { nextCheckDelay, dataAge } from './refresh.js';
import { health } from '../core/normalize.js';

export const names: Record<ProviderId,string> = {'opencode-go':'OpenCode Go', minimax:'MiniMax', codex:'Codex', antigravity:'Antigravity', kimi:'Kimi', deepseek:'DeepSeek', '302ai':'302.AI',volcengine:'火山方舟'};
const setup: Record<ProviderId,string> = {'opencode-go':'OPENCODE_GO_API_KEY · 或 OpenCode Go 本机登录', minimax:'MINIMAX_API_KEY · 默认国际版 Token Plan', codex:'先安装 Codex CLI 并完成 codex login', antigravity:'安装官方 agy 并登录；使用 agy --print /usage 查询', kimi:'先完成 kimi login · 或 KIMI_CODE_ACCESS_TOKEN', deepseek:'DEEPSEEK_API_KEY', '302ai':'AI_302_API_KEY',volcengine:'先在执行机器运行 arkcli auth login 完成登录'};
export const states = {healthy:'正常', low:'额度偏低', exhausted:'额度耗尽', unknown:'额度未知', stale:'数据已过期', error:'查询失败', 'not-configured':'未配置', unsupported:'暂无可用额度'};
const errors = {'not-configured':'未找到凭据', 'not-installed':'未找到本地 CLI', unauthorized:'凭据无效或登录已过期，请重新登录', 'rate-limited':'查询被限流，请稍后重试', timeout:'查询超时', network:'网络请求失败', 'invalid-response':'接口返回格式不受支持', upstream:'上游服务查询失败', 'command-failed':'本地 CLI 执行失败，请在终端检查登录状态', unsupported:'此账号未返回支持的额度数据'};
const fmt = (n: number) => n.toLocaleString(undefined, {maximumFractionDigits:2});
function resetText(resetAt: string | undefined, now: number) {
  if (!resetAt) return '重置时间未知';
  const minutes = Math.ceil((Date.parse(resetAt) - now) / 60000);
  if (minutes <= 0) return '已到重置时间 · 待刷新';
  return `${minutes >= 1440 ? `${Math.floor(minutes/1440)} 天 ${Math.floor(minutes%1440/60)} 小时` : minutes >= 60 ? `${Math.floor(minutes/60)} 小时 ${minutes%60} 分` : `${minutes} 分钟`}后重置`;
}
function Meter({meter:m, now, threshold}: {meter:QuotaMeter; now:number; threshold:number}) {
  return <div className="aim-meter">
    <div className="aim-row"><span>{m.name}</span><strong>{m.entitlement === 'unlimited' ? '无限' : m.entitlement === 'unsupported' ? '不在当前套餐中' : m.remainingPercent !== undefined ? `${fmt(m.remainingPercent)}% 剩余` : m.remaining !== undefined ? `${fmt(m.remaining)}${m.currency ? ` ${m.currency}` : ''} 剩余` : '未知'}</strong></div>
    {m.remainingPercent !== undefined && <div className="aim-track" role="progressbar" aria-label={`${m.name} 剩余额度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, m.remainingPercent)} aria-valuetext={`${fmt(m.remainingPercent)}% remaining`}><div style={{width:`${Math.min(100, m.remainingPercent)}%`, background:m.remainingPercent < threshold ? 'var(--aim-warning)' : 'var(--aim-accent)'}} /></div>}
    {!m.entitlement && <div className="aim-meta">{m.limit !== undefined ? `${m.used !== undefined ? `${fmt(m.used)} 已用 / ` : ''}${fmt(m.limit)} 总额 · ${m.unit === 'unknown' ? '上游额度单位' : m.unit==='afp'?'AFP':m.unit} · ` : ''}{m.kind === 'credits' ? '套餐外额外用量，不代表订阅窗口额度' : m.kind === 'balance' ? `余额${m.currency ? ` · ${m.currency}` : ' · 币种未提供'}` : <span title={m.resetAt}>{resetText(m.resetAt, now)}</span>}{m.kind === 'pool' && ' · 共享池，不按模型累加'}</div>}
  </div>;
}
function Card({snapshot:s, now, threshold}: {snapshot:QuotaSnapshot; now:number; threshold:number}) {
  const state = health(s, threshold, now);
  return <article className="aim-card">
    <div className="aim-row"><div><h3>{names[s.provider]}</h3><span className="aim-meta">{s.account.name}{s.plan ? ` · ${s.plan}` : ''}</span></div><span className={`aim-badge aim-${state}`}>{s.pending && !s.meters.length?'查询中':states[state]}</span></div>
    {s.error && <p className="aim-message">{errors[s.error]}{s.status === 'stale' && '；以下为上次成功查询结果。'}</p>}
    {s.status === 'not-configured' && <code className="aim-setup">{setup[s.provider]}</code>}
    {s.meters.map(m => <Meter key={m.id} meter={m} now={now} threshold={threshold}/>)}
    {!s.meters.length && s.status !== 'not-configured' && <p className="aim-meta">没有可展示的额度数据</p>}
    <footer className="aim-meta">{s.source} · <time dateTime={s.fetchedAt} title={s.fetchedAt}>{s.meters.length ? `数据采集于 ${dataAge(s.fetchedAt,now)}` : '尚无成功数据'}</time>{s.pending?' · 正在更新…':s.status==='stale'?' · 更新失败，显示旧数据':''}{s.nextCheckAt && <span title={new Date(s.nextCheckAt).toLocaleString()}> · 下次检查 {new Date(s.nextCheckAt).toLocaleTimeString()}</span>}</footer>
  </article>;
}
export interface DashboardProps {query:(readOnly?:boolean)=>Promise<Overview>; refresh:()=>Promise<Overview>; channels?:ChannelActions; previewQuery?:(readOnly?:boolean)=>Promise<Overview>; initialTab?:'usage'|'channels';peek?:(preview?:boolean)=>Overview|undefined}
export function Dashboard({query, refresh, channels, initialTab, peek}: DashboardProps) {
  const [configure,setConfigure]=useState(initialTab === 'channels');
  const [data, setData] = useState<Overview|undefined>(()=>peek?.());
  const [busy, setBusy] = useState(true), [error, setError] = useState(false);
  const [filter, setFilter] = useState('all'), [now, setNow] = useState(Date.now());
  const mounted = useRef(false), inflight = useRef(false), active=useRef(false), timer=useRef<ReturnType<typeof setTimeout>>(undefined);
  const load = useCallback(async (force = false,readOnly=false) => {
    if (inflight.current) return;
    clearTimeout(timer.current);inflight.current = true; setBusy(true);
    try { const result = await (force ? refresh() : query(readOnly)); if (mounted.current) {setData(result); setNow(Date.now());setError(false);const delay=nextCheckDelay(result);if(active.current && !document.hidden && delay!==undefined)timer.current=setTimeout(()=>void load(false,result.snapshots.some(s=>s.pending)),delay);} }
    catch { if (mounted.current) {setError(true);if(active.current && !document.hidden)timer.current=setTimeout(()=>void load(),30000);} }
    finally { inflight.current = false; if (mounted.current) setBusy(false); }
  }, [query, refresh]);
  useEffect(() => {
    mounted.current = true;active.current=!configure;
    const check = () => {clearTimeout(timer.current);setNow(Date.now());if(active.current && !document.hidden)void load();};
    check();
    document.addEventListener('visibilitychange', check);
    return () => {mounted.current=false;active.current=false;clearTimeout(timer.current);document.removeEventListener('visibilitychange',check);};
  }, [load, configure]);
  const rows = (data?.snapshots ?? []).filter(s=>s.status!=='not-configured');
  const healthy = rows.filter(s => health(s,data?.lowQuotaPercent ?? 10,now) === 'healthy').length;
  const lowest = rows.filter(s => s.status === 'ok' && Date.parse(s.expiresAt) > now).flatMap(s => s.meters.filter(m => !m.entitlement && m.remainingPercent !== undefined && (!m.resetAt || Date.parse(m.resetAt)>now)).map(m => ({s,m}))).sort((a,b) => a.m.remainingPercent! - b.m.remainingPercent!)[0];
  return <section className="aim" aria-label="AI Usage">
    <header className="aim-header"><div><div className="aim-eyebrow">DSH AI METER</div><h2>AI Usage <span>用量中心</span></h2><p>所有 AI 订阅、周期额度与余额，一处查看。</p></div>{!configure && <button onClick={() => void load(true)} disabled={busy}>{busy ? '查询中…' : '↻ 刷新额度'}</button>}</header>
    {channels && <div className="aim-tabs"><button type="button" aria-pressed={!configure} onClick={()=>setConfigure(false)}>用量详情</button><button type="button" aria-pressed={configure} onClick={()=>setConfigure(true)}>配置渠道</button></div>}
    {configure && channels ? <Channels actions={channels} onSaved={()=>setData(undefined)}/> : <>
    <p className="aim-footnote">按需更新 · HTTP 默认 2 分钟，CLI / SSH 默认 5 分钟 · 关闭用量界面不后台轮询</p>
    <div className="aim-summary"><div><span className="aim-meta">已监测账号</span><strong>{rows.length || '—'}</strong></div><div><span className="aim-meta">额度状态正常</span><strong>{rows.length ? healthy : '—'}</strong></div><div className="aim-lowest"><span className="aim-meta">最低已知剩余额度</span><strong>{lowest ? `${fmt(lowest.m.remainingPercent!)}%` : '—'}</strong><span className="aim-meta">{lowest ? `${names[lowest.s.provider]} / ${lowest.s.account.name} · ${lowest.m.name}` : '等待有效额度数据'}</span></div></div>
    <div className="aim-toolbar"><span className="aim-meta">各额度独立计量，不跨平台相加</span><label>筛选 <select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">所有平台</option>{Object.entries(names).map(([id,name]) => <option key={id} value={id}>{name}</option>)}</select></label></div>
    {error && <p className="aim-message" role="alert">无法连接额度服务，请检查插件是否已加载后重试。{data && '当前保留上次结果。'}</p>}
    <div aria-live="polite" className="aim-grid">{rows.filter(s => filter === 'all' || s.provider === filter).map(s => <Card key={`${s.provider}:${s.account.id}`} snapshot={s} now={now} threshold={data?.lowQuotaPercent ?? 10}/>)}</div>
    {!busy && !rows.length && !error && <p>还没有可展示的渠道，请到“配置渠道”添加或检查连接。</p>}
    <p className="aim-footnote">进度条表示剩余额度。未知与过期数据不参与路由准入。凭据仅在 DSH 服务端读取。</p></>}
  </section>;
}
