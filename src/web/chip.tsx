import React, { useEffect, useId, useRef, useState, type CSSProperties } from 'react';
import { Dashboard, names, states, type DashboardProps } from './dashboard.js';
import type { Overview, QuotaSnapshot, QuotaMeter } from '../core/types.js';
import { dataAge } from './refresh.js';
import { health } from '../core/normalize.js';
function resetLabel(resetAt:string|undefined,now:number){
  if(!resetAt || !Number.isFinite(Date.parse(resetAt)))return '重置时间未提供';
  const date=new Date(resetAt),minutes=Math.ceil((date.getTime()-now)/60000);
  const relative=minutes<=0?'已到重置时间，待刷新':minutes>=1440?`${Math.floor(minutes/1440)} 天 ${Math.floor(minutes%1440/60)} 小时后`:minutes>=60?`${Math.floor(minutes/60)} 小时 ${minutes%60} 分后`:`${minutes} 分钟后`;
  return `重置 ${date.toLocaleString('zh-CN',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false})} · ${relative}`;
}
function PreviewMeter({meter:m,now,stale}:{meter:QuotaMeter;now:number;stale:boolean}){
  const percent=m.remainingPercent,value=m.entitlement==='unlimited'?'无限':m.entitlement==='unsupported'?'套餐未包含':percent!==undefined?`${percent.toLocaleString(undefined,{maximumFractionDigits:1})}%`:m.remaining!==undefined?`${m.remaining.toLocaleString(undefined,{maximumFractionDigits:2})}${m.currency?` ${m.currency}`:''}`:'未知';
  const color=stale?'#929b9a':percent!==undefined && percent<10?'#d34e48':percent!==undefined && percent<20?'#c77a23':'#16856c';
  const full=m.name,compact=full.replace(/^codex · /i,'').replace(/^general · /i,'').replace(/Weekly/g,'周').replace(/ · /g,' ');
  const date=m.resetAt?new Date(m.resetAt):undefined;
  const sameDay=date?.toDateString()===new Date(now).toDateString();
  const dateText=date?(sameDay?date.toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit',hour12:false}):date.toLocaleDateString('zh-CN',{month:'2-digit',day:'2-digit'})):undefined;
  return <div className="aim-preview-meter">
    <span className="aim-preview-name" title={full}>{compact}</span>
    {percent!==undefined?<div className="aim-preview-track" role="progressbar" aria-label={`${full} 剩余额度`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.max(0,Math.min(100,percent))} aria-valuetext={`${value} 剩余${stale?'，旧数据':''}`}><div style={{width:`${Math.max(0,Math.min(100,percent))}%`,background:color}}/></div>:<span/>}
    <strong className="aim-preview-number">{value}</strong>
    {!m.entitlement && m.kind!=='balance' && m.kind!=='credits' && <span className="aim-preview-reset">{date?<span className="aim-reset-trigger" tabIndex={0} aria-label={resetLabel(m.resetAt,now)}><time dateTime={m.resetAt}>{dateText} 重置</time><span role="tooltip" className="aim-reset-tooltip">{resetLabel(m.resetAt,now)}</span></span>:'重置待提供'}</span>}
  </div>;
}
function PreviewCard({snapshot:s,now,threshold}:{snapshot:QuotaSnapshot;now:number;threshold:number}){
  const state=health(s,threshold,now),stale=s.status==='stale' || Date.parse(s.expiresAt)<=now;
  const platform=names[s.provider],account=s.account.name;
  const title=account.toLowerCase().includes(platform.toLowerCase())?account:`${platform} · ${account}`;
  return <article className="aim-preview-row"><header><strong title={title}>{title}</strong><span className={`aim-preview-state aim-preview-state-${state}`} aria-label={s.pending && !s.meters.length?'查询中':states[state]} title={states[state]}>{s.pending && !s.meters.length?'查询中':state==='healthy'?'●':states[state]}</span></header>
    {s.meters.map(m=><PreviewMeter key={m.id} meter={m} now={now} stale={stale}/>)}
    {s.missingMeters?.length?<p className="aim-preview-reset">待返回：{s.missingMeters.join('、')}</p>:null}
    <div className="aim-preview-age" title={new Date(s.fetchedAt).toLocaleString()}>{s.meters.length?`采集于 ${dataAge(s.fetchedAt,now)}`:'尚无成功数据'}{s.pending?' · 正在更新…':s.status==='stale'?' · 更新失败，显示旧数据':''}</div>
  </article>;
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
    let live=true,poll:ReturnType<typeof setTimeout>|undefined;setNow(Date.now());
    const cached=props.peek?.(true);if(cached)setData(cached);
    const check=(readOnly=false)=>{
      if(!live || document.hidden)return;
      setBusy(true);
      void (props.previewQuery ?? props.query)(readOnly).then(d=>{if(live){setData(d);setError(false);if(d.snapshots.some(s=>s.pending))poll=setTimeout(()=>check(true),1000);}}).catch(()=>{if(live)setError(true);}).finally(()=>{if(live)setBusy(false);});
    };
    check();
    // After active jobs finish, hovering does not poll again at cache expiry.
    const timer=setInterval(()=>setNow(Date.now()),30000);
    return()=>{live=false;clearTimeout(poll);clearInterval(timer);window.removeEventListener('resize',locate);window.removeEventListener('scroll',locate,true);};
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
  // Keep progress in the existing title row: polling must not insert/remove layout blocks.
  const updating=busy || data?.snapshots.some(s=>s.pending);
  const previewStatus=error?(data?'查询失败 · 保留上次结果':'查询失败'):updating?(data?'正在更新…':'首次查询中…'):'剩余额度';
  return <div className="aim-chip" ref={root} onMouseEnter={show} onMouseLeave={hide} onBlur={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node))hide();}}>
    <button ref={button} type="button" aria-haspopup="dialog" aria-expanded={open || preview} aria-controls={preview?previewId:undefined} aria-label="AI 用量概览" onFocus={show} onClick={()=>launch('usage')}>◔ 用量</button>
    {preview && !open && <div id={previewId} className="aim-preview" style={position} role="region" aria-label="用量总体预览" onMouseEnter={clearClose}>
      <div className="aim-preview-title"><strong>AI 用量</strong><span role="status" title={previewStatus}>{previewStatus}</span></div>
      {data?.snapshots.filter(s=>s.status!=='not-configured').map(s=><PreviewCard key={`${s.provider}:${s.account.id}`} snapshot={s} now={now} threshold={data.lowQuotaPercent}/>)}
      {data && !data.snapshots.some(s=>s.status!=='not-configured') && <p>尚未选择预览渠道或指标，请到配置渠道勾选</p>}
      <p className="aim-preview-age">按需查询 · 时间为各渠道最近成功采集时间</p>
      <div className="aim-preview-actions"><button type="button" onClick={()=>launch('usage')}>查看详情</button>{props.channels && <button type="button" onClick={()=>launch('channels')}>配置渠道</button>}</div>
    </div>}
    {open && <dialog ref={dialog} className="aim-popover" aria-label="额度与渠道" onCancel={e=>{e.preventDefault();close();}} onClick={e=>{if(e.target!==e.currentTarget)return;const r=e.currentTarget.getBoundingClientRect();if(e.clientX<r.left || e.clientX>r.right || e.clientY<r.top || e.clientY>r.bottom)close();}}><div className="aim-modal-toolbar"><span>AI 用量与渠道</span><button className="aim-close" onClick={close}>关闭</button></div><Dashboard {...props} initialTab={tab}/></dialog>}
  </div>;
}
