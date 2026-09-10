import React, { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Dashboard, names, states, type DashboardProps } from './dashboard.js';
import type { Overview, QuotaSnapshot, QuotaMeter } from '../core/types.js';
import { health } from '../core/normalize.js';
function resetLabel(resetAt:string|undefined,now:number){
  if(!resetAt || !Number.isFinite(Date.parse(resetAt)))return '重置时间未提供';
  const date=new Date(resetAt),minutes=Math.ceil((date.getTime()-now)/60000);
  const relative=minutes<=0?'已到重置时间，待刷新':minutes>=1440?`${Math.floor(minutes/1440)} 天 ${Math.floor(minutes%1440/60)} 小时后`:minutes>=60?`${Math.floor(minutes/60)} 小时 ${minutes%60} 分后`:`${minutes} 分钟后`;
  return `重置 ${date.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})} · ${relative}`;
}
function PreviewMeter({meter:m,now,stale}:{meter:QuotaMeter;now:number;stale:boolean}){
  const percent=m.remainingPercent,value=percent!==undefined?`${percent.toLocaleString(undefined,{maximumFractionDigits:1})}%`:m.remaining!==undefined?`${m.remaining.toLocaleString(undefined,{maximumFractionDigits:2})}${m.currency?` ${m.currency}`:''}`:'未知';
  const color=stale?'#929b9a':percent!==undefined && percent<10?'#d34e48':percent!==undefined && percent<20?'#c77a23':'#16856c';
  return <div className="aim-preview-meter"><div className="aim-preview-value"><span>{m.name}</span><strong>{value}</strong></div>{percent!==undefined && <div className="aim-preview-track" role="progressbar" aria-label={`${m.name} 剩余额度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0,Math.min(100,percent))} aria-valuetext={`${value} 剩余${stale?'，旧数据':''}`}><div style={{width:`${Math.max(0,Math.min(100,percent))}%`,background:color}}/></div>}{m.kind!=='balance' && <div className="aim-preview-reset">{m.resetAt?<time dateTime={m.resetAt} title={m.resetAt}>{resetLabel(m.resetAt,now)}</time>:resetLabel(undefined,now)}</div>}</div>;
}
function PreviewCard({snapshot:s,now,threshold}:{snapshot:QuotaSnapshot;now:number;threshold:number}){
  const state=health(s,threshold,now),stale=s.status==='stale' || Date.parse(s.expiresAt)<=now;
  return <article className="aim-preview-row"><header><div><strong>{names[s.provider]}</strong><small>{s.account.name}</small></div><span className={`aim-preview-state aim-preview-state-${state}`}>{states[state]}</span></header>{s.meters.map(m=><PreviewMeter key={m.id} meter={m} now={now} stale={stale}/>)}{s.missingMeters?.length? <p className="aim-preview-reset">待返回：{s.missingMeters.join('、')}</p>:null}</article>;
}
export function QuotaChip(props:DashboardProps) {
  const [position,setPosition]=useState<CSSProperties>({});
  const [preview,setPreview]=useState(false),[tab,setTab]=useState<'usage'|'channels'>('usage'),[open,setOpen]=useState(false);
  const [data,setData]=useState<Overview>(),[error,setError]=useState(false),[busy,setBusy]=useState(false),[now,setNow]=useState(Date.now());
  const root=useRef<HTMLDivElement>(null),button=useRef<HTMLButtonElement>(null),dialog=useRef<HTMLDialogElement>(null),closeTimer=useRef<ReturnType<typeof setTimeout>>(undefined),previewId=useId();
  const locate=()=>{const rect=button.current?.getBoundingClientRect();if(!rect)return;const width=Math.min(420,window.innerWidth-32);const above=rect.top>200;setPosition({position:'fixed',width,left:Math.max(16,Math.min(rect.left,window.innerWidth-width-16)),bottom:above?window.innerHeight-rect.top+8:'auto',top:above?'auto':rect.bottom+8,maxHeight:Math.max(100,Math.min(window.innerHeight*.65,above?rect.top-24:window.innerHeight-rect.bottom-24))});};
  const clearClose=()=>clearTimeout(closeTimer.current);
  const show=()=>{clearClose();if(!open){locate();setPreview(true);}};
  const hide=()=>{clearClose();closeTimer.current=setTimeout(()=>setPreview(false),160);};
  const launch=(next:'usage'|'channels')=>{clearClose();setPreview(false);setTab(next);setOpen(true);};
  const close=()=>{setOpen(false);setPreview(false);button.current?.focus();};
  useEffect(()=>()=>clearTimeout(closeTimer.current),[]);
  useEffect(()=>{
    if(!preview || open)return;
    window.addEventListener('resize',locate);window.addEventListener('scroll',locate,true);
    let live=true;setNow(Date.now());setBusy(true);
    void (props.previewQuery ?? props.query)().then(d=>{if(live){setData(d);setError(false);}}).catch(()=>{if(live)setError(true);}).finally(()=>{if(live)setBusy(false);});
    // Only the on-screen age label ticks; no network polling in the preview.
    const timer=setInterval(()=>setNow(Date.now()),30000);
    return()=>{live=false;clearInterval(timer);window.removeEventListener('resize',locate);window.removeEventListener('scroll',locate,true);};
  },[preview,open,props.query,props.previewQuery]);
  useEffect(()=>{
    if(!open && !preview)return;
    if(open){if(dialog.current && !dialog.current.open)dialog.current.showModal();dialog.current?.querySelector<HTMLButtonElement>('button')?.focus();}
    const key=(e:KeyboardEvent)=>{
      if(e.key==='Escape'){e.preventDefault();if(open)close();else setPreview(false);}
      if(open && e.key==='Tab'){
        const targets=Array.from(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href], summary, [tabindex="0"]') ?? []).filter(el=>el.getClientRects().length);
        const first=targets[0],last=targets.at(-1);
        if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus();}
      }
    };
    const outside=(e:PointerEvent)=>{if(!root.current?.contains(e.target as Node))setPreview(false);};
    document.addEventListener('keydown',key);document.addEventListener('pointerdown',outside);
    return()=>{document.removeEventListener('keydown',key);document.removeEventListener('pointerdown',outside);};
  },[open,preview]);
  useEffect(()=>{
    if(!open)return;
    const previous=document.body.style.overflow;document.body.style.overflow='hidden';
    return()=>{document.body.style.overflow=previous;};
  },[open]);
  const checked=data?.snapshots.map(s=>Date.parse(s.checkedAt)).filter(Number.isFinite).sort((a,b)=>b-a)[0];
  return <div className="aim-chip" ref={root} onMouseEnter={show} onMouseLeave={hide} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))hide();}}>
    <button ref={button} type="button" aria-haspopup="dialog" aria-expanded={open || preview} aria-controls={preview?previewId:undefined} aria-label="AI 用量概览" onFocus={show} onClick={()=>launch('usage')}>◔ 用量</button>
    {preview && !open && <div id={previewId} className="aim-preview" style={position} role="region" aria-label="用量总体预览" onMouseEnter={clearClose}>
      <div className="aim-preview-title"><strong>AI 用量</strong><span>剩余额度</span></div>
      {busy && <p role="status">{data?'正在检查更新…':'首次查询中…'}</p>}
      {error && <p role="status">查询失败{data?' · 保留上次结果':''}</p>}
      {data?.snapshots.filter(s=>s.status!=='not-configured').map(s=><PreviewCard key={`${s.provider}:${s.account.id}`} snapshot={s} now={now} threshold={data.lowQuotaPercent}/>)}
      {!busy && data && !data.snapshots.some(s=>s.status!=='not-configured') && <p>尚未选择预览渠道或指标，请到配置渠道勾选</p>}
      <p className="aim-preview-age">按需查询 · {checked?`最近检查 ${new Date(checked).toLocaleTimeString()}`:'尚未取得数据'} · 各账号时间见详情</p>
      <div className="aim-preview-actions"><button type="button" onClick={()=>launch('usage')}>查看详情</button>{props.channels && <button type="button" onClick={()=>launch('channels')}>配置渠道</button>}</div>
    </div>}
    {open && <dialog ref={dialog} className="aim-popover" aria-label="额度与渠道" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom)close();}}><div className="aim-modal-toolbar"><span>AI 用量与渠道</span><button className="aim-close" onClick={close}>关闭</button></div><Dashboard {...props} initialTab={tab}/></dialog>}
  </div>;
}
