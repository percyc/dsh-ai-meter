import React, { useEffect, useState } from 'react';
import { names } from './dashboard.js';
import type { ProviderId, QuotaSnapshot } from '../core/types.js';
import { effectiveQuery, cliProvider, type QueryConfig } from '../core/channel.js';
import { queryDescription, meterDescription, httpCurl } from '../core/methods.js';
import type { ChannelConfiguration, ChannelSave, SecretSave } from '../server/channels.js';
export interface ChannelActions {
  getConfiguration:()=>Promise<ChannelConfiguration>;saveConfiguration:(input:ChannelSave)=>Promise<ChannelConfiguration>;setCredential:(input:SecretSave)=>Promise<ChannelConfiguration>;
  inspect:(provider:ProviderId,account:string)=>Promise<QuotaSnapshot>;discoverLocal:()=>Promise<ProviderId[]>;
}
type Channel=NonNullable<ChannelConfiguration['accounts'][ProviderId]>[number];
function HttpCommand({command}:{command?:string}){
  const [copied,setCopied]=useState(false),[failed,setFailed]=useState(false);
  useEffect(()=>{setCopied(false);setFailed(false);},[command]);
  if(!command)return null;
  return <div className="aim-curl"><p className="aim-config-help">手动验证：先在终端设置 AI_METER_TOKEN 为此渠道的 API Key / Access Token，再执行以下命令。示例不包含已保存的真实凭据，不会自动读取 DSH 的密钥。</p><pre><code>{command}</code></pre><button type="button" onClick={()=>{void Promise.resolve().then(()=>navigator.clipboard.writeText(command)).then(()=>{setCopied(true);setFailed(false);}).catch(()=>setFailed(true));}}>{copied?'已复制 curl':'复制 curl'}</button>{failed && <p role="status">无法访问剪贴板，请选中上方命令复制。</p>}</div>;
}
const failureText=(snapshot:QuotaSnapshot | undefined)=>snapshot?.error ? ({'not-configured':'没有找到可用登录或 Key，请回到连接配置。','not-installed':snapshot.provider==='antigravity'?'未找到配置的官方 agy 命令，请检查安装位置。':'执行机器没有找到 CLI，请检查安装位置。',unauthorized:'登录已过期或 Key 无效，请重新登录或更换 Key.',network:'网络连接失败，请检查 DSH 服务端网络。',timeout:'查询超时；SSH 渠道请检查主机连接。','command-failed':'CLI 或 SSH 执行失败，请核对主机、命令路径和登录状态。','invalid-response':'上游返回格式不受支持。','rate-limited':'上游限流，请稍后重试。',upstream:'上游服务返回错误。',unsupported:'没有返回可用额度。'} as Record<string,string>)[snapshot.error]:undefined;
export function Channels({actions,onSaved}: {actions:ChannelActions;onSaved:()=>void}) {
  const [step,setStep]=useState(0);
  const [checking,setChecking]=useState<string>(),[deleteTarget,setDeleteTarget]=useState<string>(),[checks,setChecks]=useState<Record<string,string>>({});
  const [view,setView]=useState<'list'|'new'|'edit'|'create'>('list');
  const [data,setData]=useState<ChannelConfiguration>(),[draft,setDraft]=useState<ChannelConfiguration['accounts']>({}),[provider,setProvider]=useState<ProviderId>('opencode-go');
  const [secret,setSecret]=useState(''),[account,setAccount]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[dirty,setDirty]=useState(false);
  const [catalog,setCatalog]=useState<Record<string,QuotaSnapshot>>({}),[discovered,setDiscovered]=useState<ProviderId[]>();
  const accept=(next:ChannelConfiguration)=>{setData(next);setDraft(next.accounts);setDirty(false);setSecret('');};
  useEffect(()=>{let live=true;void actions.getConfiguration().then(d=>{if(live)accept(d);}).catch(()=>{if(live)setMessage('无法读取渠道配置');});return()=>{live=false;};},[actions]);
  const run=async(work:()=>Promise<ChannelConfiguration>)=>{setBusy(true);setMessage('');try{accept(await work());setMessage('已保存并生效');onSaved();}catch{setSecret('');setMessage('保存失败。请检查 SSH 主机是否填写、查询方式是否匹配；配置也可能已被其他页面修改，请重新读取核对。密钥与渠道分开保存，失败后也需核对。');}finally{setBusy(false);}};
  const checkChannel=async(id:ProviderId,a:Channel)=>{
    if(busy || a.enabled===false)return;
    const key=`${id}:${a.id}`;setBusy(true);setChecking(key);setDeleteTarget(undefined);
    try{
      const result=await actions.inspect(id,a.id);
      setCatalog(old=>({...old,[key]:result}));
      setChecks(old=>({...old,[key]:`${result.status==='ok'?`校验成功 · ${result.meters.length} 项指标`:`校验失败 · ${failureText(result) ?? '未取得有效结果，请编辑检查连接。'}`} · ${new Date(result.checkedAt).toLocaleTimeString()}`}));
    }catch{setChecks(old=>({...old,[key]:'校验失败 · 无法连接额度服务，请重试。'}));}
    finally{setBusy(false);setChecking(undefined);}
  };
  const deleteChannel=async(id:ProviderId,a:Channel)=>{
    if(busy || !data)return;
    setBusy(true);setMessage('');
    try{
      accept(await actions.saveConfiguration({revision:data.revision,accounts:{...data.accounts,[id]:(data.accounts[id] ?? []).filter(r=>r.id!==a.id)}}));
      setDeleteTarget(undefined);setMessage('渠道已删除，已保存凭据仍保留。');onSaved();
      const key=`${id}:${a.id}`;
      setCatalog(old=>{const next={...old};delete next[key];return next;});
      setChecks(old=>{const next={...old};delete next[key];return next;});
    }catch{setMessage('删除失败，配置可能已被其他页面修改。请重新打开渠道列表后重试。');}
    finally{setBusy(false);}
  };
  const rows=draft[provider] ?? [],selected=rows.some(r=>r.id===account)?account:rows[0]?.id ?? '',row=rows.find(r=>r.id===selected),index=rows.findIndex(r=>r.id===selected);
  const info=data?.credentials.find(c=>c.provider===provider && c.account===selected),key=`${provider}:${selected}`,snapshot=catalog[key];
  const q=row?effectiveQuery(provider,row):undefined,p=row?.presentation ?? {visible:true,order:0,labels:{}},meters=snapshot?.meters ?? [];
  const ids=[...new Set([...(p.meterIds ?? []),...meters.map(m=>m.id)])];
  const saved=data?.accounts[provider]?.find(r=>r.id===selected);
  const methodUnchanged=JSON.stringify([row?.query,row?.region,row?.planType])===JSON.stringify([saved?.query,saved?.region,saved?.planType]);
  const edit=(value:Partial<Channel>)=>{setDraft({...draft,[provider]:rows.map(r=>r.id===selected?{...r,...value}:r)});setDirty(true);setMessage('');if(value.query || value.region || value.planType){setCatalog(old=>{const next={...old};delete next[key];return next;});}};
  const presentation=(value:Partial<typeof p>)=>edit({presentation:{...p,...value}});
  const query=(value:QueryConfig)=>{edit({query:value});setSecret('');};
  const add=(id:ProviderId,discovery=false)=>{
    const accountId=`${discovery?'local':'channel'}-${Date.now()}`;
    setDraft({...draft,[id]:[...(draft[id] ?? []),{id:accountId,name:discovery?`${names[id]} 本机`:'新渠道',enabled:true,query:cliProvider(id)?{kind:'cli',location:'local'}:{kind:'http',auth:discovery?'auto':'api-key'},presentation:{visible:false,order:0,labels:{}}}]});
    setView('create');setStep(0);setProvider(id);setAccount(accountId);setDirty(true);setSecret('');setMessage('');
  };
  const discover=async()=>{setBusy(true);try{setDiscovered(await actions.discoverLocal());}catch{setMessage('本机来源检查失败');}finally{setBusy(false);}};
  const move=(id:string,delta:number)=>{const next=[...(p.meterIds ?? [])],i=next.indexOf(id),j=i+delta;if(i>=0 && j>=0 && j<next.length){[next[i],next[j]]=[next[j],next[i]];presentation({meterIds:next});}};
  const connect=async()=>{
    if(!row || !data)return;
    if(row.enabled===false){setMessage('此渠道已停用，请先打开“启用此渠道”。');return;}
    if(q?.kind==='cli' && q.location==='ssh' && !q.sshHost){setMessage('请填写 SSH 主机别名，例如 workstation。');return;}
    setBusy(true);setMessage('');
    let config=data,phase='config';
    try{
      if(dirty){config=await actions.saveConfiguration({revision:config.revision,accounts:draft});accept(config);onSaved();}
      if(q?.kind==='http' && secret.trim()){phase='secret';config=await actions.setCredential({revision:config.revision,provider,account:selected,secret});accept(config);onSaved();}
      phase='query';const result=await actions.inspect(provider,selected);setCatalog(old=>({...old,[key]:result}));setStep(2);
    }catch{setMessage(phase==='config'?'配置未保存，请检查输入或重新读取最新配置。':phase==='secret'?'渠道已保存，但密钥保存失败，请重新填写后重试。':'渠道已保存，但未能取得查询结果，请检查连接后重试。');}
    finally{setSecret('');setBusy(false);}
  };
  const failure=failureText(snapshot);
  const mode=q?.kind==='http'?q.auth:q?.kind;
  const choose=(next:string)=>{if(next!==mode)query(next==='cli'?{kind:'cli',location:'local'}:{kind:'http',auth:next as 'auto'|'api-key'});};
  const switchProvider=(id:ProviderId)=>{setProvider(id);setAccount('');setSecret('');setMessage('');setStep(0);};
  const valueText=(id:string)=>{const m=meters.find(m=>m.id===id);return m?.remainingPercent!==undefined?`${m.remainingPercent.toLocaleString(undefined,{maximumFractionDigits:1})}% 剩余`:m?.remaining!==undefined?`${m.remaining.toLocaleString()} ${m.currency ?? ''} 剩余`:'暂未返回';};
  const steps=['选择渠道','连接配置','查询结果','预览内容'];
  return <div className="aim-config">
    {view==='list' || view==='new' ? <>
      <div className="aim-config-top"><div><h3>已有渠道</h3><p>管理已添加的账号，以及它们在悬停预览中的显示。</p></div><button disabled={busy || !data?.writable} onClick={()=>setView('new')}>＋ 新增渠道</button></div>
      {view==='new' && <div className="aim-config-body"><h3>新增渠道</h3><label>平台<select aria-label="新增渠道平台" value={provider} onChange={e=>setProvider(e.target.value as ProviderId)}>{Object.entries(names).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label><div className="aim-config-actions"><button onClick={()=>setView('list')}>取消</button><button disabled={!data?.writable || rows.length>=30} onClick={()=>add(provider)}>开始配置 →</button></div></div>}
      {!data && <p>正在读取配置…</p>}
      {data && !Object.values(data.accounts).some(rows=>rows?.length) && <p>还没有渠道。点击“新增渠道”添加。</p>}
      <div className="aim-channel-list">{Object.entries(data?.accounts ?? {}).flatMap(([id,accounts])=>(accounts ?? []).map(a=>{
        const providerId=id as ProviderId,source=data?.credentials.find(c=>c.provider===id && c.account===a.id),query=effectiveQuery(providerId,a);
        return <article className="aim-channel-item" key={`${id}:${a.id}`} aria-label={`${names[providerId]} ${a.name || a.id}`}><div><strong>{a.name || a.id}</strong><p>{names[providerId]} · {query.kind==='http'?'HTTP':query.location==='ssh'?`SSH · ${query.sshHost}`:'本机 CLI'} · {a.enabled===false?'已停用':a.presentation?.visible===false || a.presentation?.meterIds?.length===0?'不在预览显示':'在预览显示'}</p><small>{source?.source}</small>{checks[`${id}:${a.id}`] && <p role="status">{checks[`${id}:${a.id}`]}</p>}{deleteTarget===`${id}:${a.id}` && <div className="aim-delete-confirm"><p>删除“{a.name || a.id}”？将移除渠道配置和显示，保留已保存凭据。</p><button disabled={busy} onClick={()=>void deleteChannel(providerId,a)}>确认删除</button> <button disabled={busy} onClick={()=>setDeleteTarget(undefined)}>取消删除</button></div>}</div><div className="aim-channel-actions"><button disabled={busy || a.enabled===false} title={a.enabled===false?'先启用渠道后再校验':'重新查询此账号，跳过缓存'} onClick={()=>void checkChannel(providerId,a)}>{checking===`${id}:${a.id}`?'校验中…':'校验'}</button><button disabled={busy} onClick={()=>{setProvider(providerId);setAccount(a.id);setStep(1);setView('edit');setMessage('');}}>编辑</button><button disabled={busy || !data?.writable} onClick={()=>void run(()=>actions.saveConfiguration({revision:data!.revision,accounts:{...data!.accounts,[id]:accounts!.map(r=>r.id===a.id?{...r,enabled:a.enabled===false}:r)}}))}>{a.enabled===false?'启用':'停用'}</button><button disabled={busy || !data?.writable} onClick={()=>setDeleteTarget(`${id}:${a.id}`)}>删除</button></div></article>;
      }))}</div>
      {message && <p role="status">{message}</p>}
    </> : <>
    <div className="aim-config-top"><div><h3>{view==='create'?'新增渠道':'编辑渠道'} · {names[provider]}</h3><p>{view==='create'?'验证连接后，选择关注的指标。':'直接选择要修改的部分，无需重新完成新增流程。'}</p></div><button disabled={busy || dirty || !!secret} onClick={()=>setView('list')}>← 返回渠道列表</button></div>
    <nav className="aim-steps" aria-label="配置步骤">{steps.map((name,i)=><button key={name} disabled={busy || !row} aria-current={step===i?'step':undefined} onClick={()=>setStep(i)}>{view==='create' && <span>{i+1}</span>}{i===0 && view==='edit'?'账号与来源':name}</button>)}</nav>
    {!data && <p>正在读取配置…</p>}
    {data && !row && <p>这个平台还没有渠道。点击“新建渠道”开始。</p>}
    {row && <fieldset className="aim-config-body" disabled={busy || !data?.writable}>
      {step===0 && <>
        <h3>账号名称与凭据来源</h3>
        <label>渠道名称<input aria-label="渠道名称" value={row.name ?? ''} onChange={e=>edit({name:e.target.value})} placeholder="例如：本机 OpenCode、工作站 Codex"/></label>
        <p className="aim-config-help">选择凭据来源。只显示此平台实际支持的方式。</p>
        <div className="aim-source-options">
          {cliProvider(provider)?<button type="button" aria-pressed={mode==='cli'} onClick={()=>choose('cli')}><strong>{provider==='antigravity'?'使用官方 agy CLI':'使用 CLI 登录'}</strong><small>下一步选择本机或 SSH 远端。</small></button>:<><button type="button" aria-pressed={mode==='api-key'} onClick={()=>choose('api-key')}><strong>填写 API Key / Token</strong><small>下一步填写这个账号的专用凭据。</small></button><button type="button" aria-pressed={mode==='auto'} onClick={()=>choose('auto')}><strong>沿用 DSH 已有凭据</strong><small>从 DSH 凭据配置或已支持的本机登录文件读取。</small></button></>}
        </div>
        <label className="aim-check"><input type="checkbox" checked={row.enabled!==false} onChange={e=>edit({enabled:e.target.checked})}/>启用此渠道</label>
        <div className="aim-config-actions">{view==='edit' && row.enabled!==false && <button disabled={!dirty} onClick={()=>void run(()=>actions.saveConfiguration({revision:data!.revision,accounts:draft}))}>保存账号设置</button>}{row.enabled===false?<button disabled={!dirty} onClick={()=>void run(()=>actions.saveConfiguration({revision:data!.revision,accounts:draft}))}>保存停用设置</button>:<button onClick={()=>setStep(1)}>下一步：连接配置 →</button>}</div>
        <details><summary>从本机发现其他已有登录</summary><button onClick={()=>void discover()}>发现本机来源</button>{discovered && <div className="aim-discovery"><p>仅检查登录文件或命令是否存在，不自动添加。</p>{discovered.map(id=><button key={id} disabled={dirty || !!secret} onClick={()=>add(id,true)}>添加 {names[id]} 本机来源</button>)}</div>}</details>
      </>}
      {step===1 && <>
        <h3>连接到 {row.name || names[provider]}</h3>
        {q?.kind==='cli' && <><label>执行位置<select aria-label="执行位置" value={q.location} onChange={e=>query({...q,location:e.target.value as 'local'|'ssh'})}><option value="local">DSH 本机</option><option value="ssh">SSH 远端</option></select></label>{q.location==='ssh' && <label>SSH 主机<input aria-label="SSH 主机" value={q.sshHost ?? ''} onChange={e=>query({...q,sshHost:e.target.value})} placeholder="例如 workstation 或 me@server"/></label>}<p className="aim-config-help">使用执行机器上 CLI 的已有登录，不需要在这里粘贴密钥。</p><details><summary>高级：命令路径与登录目录</summary><label>CLI 可执行文件<input value={q.executable ?? ''} onChange={e=>query({...q,executable:e.target.value || undefined})} placeholder={q.location==='ssh'?'留空自动查找远端路径':provider==='codex'?'codex':'agy'}/>{q.location==='ssh' && <small>留空自动检查远端 PATH、登录 Shell PATH 和 ~/.local/bin 等常见安装目录；填写后严格使用指定路径。</small>}</label><label>{provider==='codex'?'CODEX_HOME':'HOME'}<input value={q.home ?? ''} onChange={e=>query({...q,home:e.target.value || undefined})} placeholder="留空使用默认目录"/></label></details></>}
        {provider==='antigravity' && <div className="aim-connection-note"><strong>通过官方 agy CLI 查询</strong><p>直接执行 agy --print /usage，返回模型组、5h / Weekly 剩余百分比及重置时间。使用 agy 自有登录，不需要第三方工具。</p><div className="aim-curl"><pre><code>agy --print /usage</code></pre></div><p>请在查询执行机器上先运行上述命令确认结果。未登录时运行 agy 完成登录；高级配置可填写 agy 的绝对路径。旧版桥接命令和预设 args 不再支持。</p><a href="https://antigravity.google/docs/cli/headless/" target="_blank" rel="noreferrer">官方 headless 文档 ↗</a> · <a href="https://antigravity.google/docs/cli/commands/usage/" target="_blank" rel="noreferrer">交互式 /usage 说明 ↗</a></div>}
        {provider==='opencode-go' && <div className="aim-connection-note"><strong>当前通过 HTTP 接口查询 OpenCode Go</strong><p>可以沿用已有 Key 或受支持的本机登录文件。尚不支持 OpenCode CLI 额度命令和网页 Cookie 查询。</p></div>}
        {q?.kind==='http' && <><p className="aim-config-help">{q.auth==='auto'?'会沿用下方显示的凭据来源。':'填入该账号的 Key；已保存过时可以留空沿用。'}</p>{q.auth==='api-key' && <label>API Key / Token<input type="password" aria-label="API Key / Token" autoComplete="new-password" value={secret} onChange={e=>setSecret(e.target.value)} placeholder="已保存的密钥不会回显"/></label>}</>}
        {provider==='minimax' && <><label>区域<select value={row.region ?? 'global'} onChange={e=>edit({region:e.target.value as 'global'|'cn'})}><option value="global">国际站</option><option value="cn">国内站</option></select></label><label>套餐<select value={row.planType ?? 'token'} onChange={e=>edit({planType:e.target.value as 'token'|'coding'})}><option value="token">Token Plan</option><option value="coding">旧 Coding Plan</option></select></label></>}
        <p className="aim-config-help">当前凭据来源：{methodUnchanged ? info?.source ?? '未配置' : '已修改，保存后确认'}</p>
        <details><summary>查看查询方法与凭据来源</summary><p className="aim-method">{methodUnchanged && info?.method ? info.method : queryDescription(provider,row)}</p><HttpCommand command={httpCurl(provider,row)}/><p>{methodUnchanged?info?.source:'来源已修改，保存验证后更新。'}</p></details>
        <div className="aim-config-actions"><button onClick={()=>setStep(0)}>← 上一步</button><button className="aim-primary" onClick={()=>void connect()}>保存并验证连接</button></div>
      </>}
      {step===2 && <>
        <h3>查询结果</h3>
        {snapshot?<><div className={`aim-result ${snapshot.status==='ok'?'aim-result-ok':''}`}><strong>{snapshot.status==='ok'?`连接成功 · 找到 ${meters.length} 项指标`:'暂时未查询成功'}</strong><p>{failure ?? `最近检查：${new Date(snapshot.checkedAt).toLocaleTimeString()}`}</p></div>{meters.length>0 && <div className="aim-result-list">{meters.map(m=><div key={m.id}><span>{m.name}</span><strong>{valueText(m.id)}</strong></div>)}</div>}</>:<p>还没有验证这个渠道。先到上一步保存并查询。</p>}
        <details><summary>查看本次查询方法</summary><p className="aim-method">{info?.method ?? queryDescription(provider,row)}</p><HttpCommand command={httpCurl(provider,row)}/></details>
        <div className="aim-config-actions"><button onClick={()=>setStep(1)}>← 返回连接配置</button><button onClick={()=>void connect()}>重新验证</button><button className="aim-primary" disabled={!meters.length} onClick={()=>setStep(3)}>选择预览指标 →</button></div>
      </>}
      {step===3 && <>
        <h3>悬停时想看什么？</h3>{(!saved || !methodUnchanged || !!secret) && <p className="aim-config-help">连接信息尚未保存，请先到第 2 步保存并验证。</p>}
        <label className="aim-check"><input type="checkbox" checked={p.visible} onChange={e=>presentation({visible:e.target.checked})}/>显示这个渠道</label>
        <p className="aim-config-help">取消 Weekly 只会隐藏预览中的周额度，详情仍保留完整数据。</p>
        {!ids.length && <p>还没有指标列表。请先到“查询结果”验证连接。</p>}
        {ids.map(id=>{const m=meters.find(m=>m.id===id),checked=p.meterIds===undefined || p.meterIds.includes(id);return <div className="aim-wizard-metric" key={id}><div><label className="aim-check"><input type="checkbox" checked={checked} onChange={e=>{const current=p.meterIds ?? meters.map(m=>m.id);presentation({meterIds:e.target.checked?[...current,id]:current.filter(x=>x!==id)});}}/>{m?.name ?? p.labels[id] ?? id}</label><span>{valueText(id)}</span></div><details><summary>改名、排序与取值说明</summary><label>预览名称<input aria-label={`指标别名 ${id}`} value={p.labels[id] ?? ''} onChange={e=>presentation({labels:{...p.labels,[id]:e.target.value}})} placeholder={m?.name ?? id}/></label>{p.meterIds!==undefined && checked && <><button onClick={()=>move(id,-1)}>上移</button><button onClick={()=>move(id,1)}>下移</button></>}<p className="aim-config-help">{m?meterDescription(provider,m):'本次没有返回此指标，保留原有选择。'}</p><code>{id}</code></details></div>;})}
        <details><summary>其他显示设置</summary><label className="aim-check"><input type="checkbox" checked={p.meterIds===undefined} onChange={e=>presentation({meterIds:e.target.checked?undefined:meters.map(m=>m.id)})}/>自动加入以后新增的指标</label><label>渠道排序<input type="number" value={p.order} onChange={e=>presentation({order:Number(e.target.value)})}/></label><label>账号归属标记<input value={row.identity ?? ''} onChange={e=>edit({identity:e.target.value})}/></label></details>
        <div className="aim-config-actions"><button onClick={()=>setStep(2)}>← 查询结果</button><button className="aim-primary" disabled={!dirty || !saved || !methodUnchanged || !!secret} onClick={()=>void run(()=>actions.saveConfiguration({revision:data!.revision,accounts:draft}))}>保存显示设置</button></div>
      </>}
    </fieldset>}
    {busy && <p role="status">正在保存或查询，请稍候…</p>}{message && <p role="status" className="aim-config-notice">{message}</p>}
    {(dirty || !!secret) && !busy && <p className="aim-config-help">保存或放弃当前修改后，可以切换渠道。 <button onClick={()=>{if(data)accept(data);if(view==='create')setView('list');setMessage('已放弃未保存修改');}}>放弃修改</button></p>}
    <details className="aim-config-maintenance"><summary>管理与恢复</summary><button disabled={busy} onClick={()=>void run(actions.getConfiguration)}>重新读取配置（放弃未保存修改）</button>{row && <button disabled={busy || !data?.writable} onClick={()=>void run(async()=>{const result=await actions.saveConfiguration({revision:data!.revision,accounts:{...draft,[provider]:rows.filter(r=>r.id!==selected)}});setView('list');return result;})}>移除此渠道</button>}<p className="aim-config-help">移除不删除已保存凭据。Cookie 查询和 OpenCode 远端登录读取尚未支持。</p></details>
    </>}
  </div>;
}
