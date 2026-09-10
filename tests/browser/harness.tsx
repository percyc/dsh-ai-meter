import React from 'react';
import * as jsx from 'react/jsx-runtime';
import { createRoot } from 'react-dom/client';
import { projectPreview } from '../../src/core/presentation.js';
import type { ChannelConfiguration } from '../../src/server/channels.js';
import { overview } from '../../src/core/normalize.js';
import type { QuotaSnapshot } from '../../src/core/types.js';

declare global { interface Window {__ModuleLoader__:{load:(plugin:{id:string;factory:(require:(id:string)=>unknown)=>{apply:(ctx:unknown)=>void}})=>void}; testFail:boolean; refreshCount:number;queryCount:number} }
window.testFail=false;window.refreshCount=0;window.queryCount=0;
const now=Date.now();
const make=(provider:QuotaSnapshot['provider'],meters:QuotaSnapshot['meters'],status:QuotaSnapshot['status']='ok'):QuotaSnapshot=>({provider,account:{id:'default',name:'Personal'},meters,status,source:'DEMO · Synthetic fixture',fetchedAt:new Date(now).toISOString(),checkedAt:new Date(now).toISOString(),expiresAt:new Date(now+120000).toISOString()});
const snapshots:QuotaSnapshot[]=[
  make('opencode-go',[{id:'5h',name:'5h',kind:'window',unit:'percent',remainingPercent:72,resetAt:new Date(now+7200000).toISOString()},{id:'weekly',name:'Weekly',kind:'window',unit:'percent',remainingPercent:43},{id:'monthly',name:'Monthly',kind:'window',unit:'percent',remainingPercent:81}]),
  make('codex',[{id:'5h',name:'5h',kind:'window',unit:'percent',remainingPercent:55},{id:'weekly',name:'Weekly',kind:'window',unit:'percent',remainingPercent:84}]),
  make('minimax',[{id:'5h',name:'general · 5h',kind:'window',unit:'percent',remainingPercent:67},{id:'week',name:'general · Weekly',kind:'window',unit:'percent',remainingPercent:85}]),
  make('antigravity',[{id:'gemini-weekly',name:'Gemini · Weekly',kind:'window',unit:'percent',remainingPercent:99},{id:'gemini-5h',name:'Gemini · 5h',kind:'window',unit:'percent',remainingPercent:100},{id:'claude-gpt-weekly',name:'Claude / GPT · Weekly',kind:'window',unit:'percent',remainingPercent:61},{id:'claude-gpt-5h',name:'Claude / GPT · 5h',kind:'window',unit:'percent',remainingPercent:85}]),
  make('deepseek',[{id:'usd',name:'Balance',kind:'balance',unit:'money',remaining:18.42,currency:'USD'}]),
  {...make('kimi',[],'not-configured'),error:'not-configured'},
  {...make('302ai',[{id:'balance',name:'Balance',kind:'balance',unit:'money',remaining:3.6}],'stale'),error:'network'},
];
const result=()=>overview(snapshots.flatMap(s=>(configuration.accounts[s.provider] ?? []).filter(a=>a.enabled!==false).map(a=>({...s,account:{id:a.id,name:a.name ?? a.id}}))),Date.now(),10);
let configuration:ChannelConfiguration={revision:0,writable:true,accounts:Object.fromEntries(snapshots.map(s=>[s.provider,[{id:'default',name:'Personal'}]])),credentials:snapshots.map(s=>({provider:s.provider,account:'default',source:'DEMO existing login',canSet:!['codex','antigravity'].includes(s.provider)}))};
const remote={discoverLocal:async()=>({ok:true,value:['opencode-go','codex']}),testConnection:async(provider:string,account:string)=>({ok:true,value:result().snapshots.find(s=>s.provider===provider && s.account.id===account)}),getPreview:async(...args:unknown[])=>{if(args.length!==0)throw Error('No preview parameters');window.queryCount++;return {ok:true,value:projectPreview(result(),configuration.accounts)};},getConfiguration:async()=>({ok:true,value:configuration}),saveConfiguration:async(input:typeof configuration)=>{configuration={...configuration,accounts:input.accounts,revision:configuration.revision+1};return {ok:true,value:configuration};},setCredential:async()=>({ok:true,value:{...configuration,revision:++configuration.revision}}),getAllUsage:async(...args:unknown[])=>{window.queryCount++;if(args.length!==1)throw Error('Typert requires one positional filter argument');return {ok:true,value:result()};},refresh:async(...args:unknown[])=>{if(args.length!==1)throw Error('Typert requires one positional filter argument');window.refreshCount++;if(window.testFail)return {ok:false,error:{code:'transport',message:'RPC failed'}};return {ok:true,value:result()};}};
window.__ModuleLoader__={load(plugin){
  const exports=plugin.factory(id=>{if(id==='react')return React;if(id==='react/jsx-runtime')return jsx;throw new Error('Unexpected browser dependency '+id);});
  exports.apply({remote:{$mount:async()=>{}},get:()=>remote,effect:(fn:()=>unknown)=>fn(),slots:{inject:(_name:string,fn:()=>unknown)=>fn(),register:(def:{name:string;inject:()=>object},Component:React.ComponentType)=>{if(def.name==='settings.section' && new URLSearchParams(location.search).has('chip'))return;const target=def.name==='settings.section'?document.getElementById('root')!:document.body.appendChild(document.createElement('div'));createRoot(target).render(React.createElement(Component,def.inject()));}}});
}};
const script=document.createElement('script');script.src='/client.js';document.body.appendChild(script);
