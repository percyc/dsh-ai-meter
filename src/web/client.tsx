import type { ComponentType } from 'react';
import { QuotaChip } from './chip.js';
import { channelConfigurationSchema, type ChannelSave, type SecretSave } from '../server/channels.js';
import { Dashboard } from './dashboard.js';
import { descriptors } from '../server/manifest.js';
import { styles } from './styles.js';
import { overviewSchema, snapshotSchema, type Overview, type ProviderId } from '../core/types.js';
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol';
// This structural type is limited to the verified client extension seam.
interface ClientContext {
  remote: {$mount(value:unknown):unknown};
  get(name:string): Record<string,(...args:unknown[])=>Promise<RemoteResult<unknown>>> | undefined;
  effect(fn:()=>()=>void):unknown;
  slots:{inject(name:string, fn:()=>unknown):unknown; register(def:unknown, component:ComponentType<any>):unknown};
}
export const inject = ['slots','remote'];
export function apply(ctx: ClientContext) {
  const ready = ctx.remote.$mount({package:'dsh-ai-meter', descriptors});
  const invoke = async (method:string,...args:unknown[]) => {
    await ready;
    const api = ctx.get('remote.aiMeter');
    if (!api) throw new Error('AI Meter unavailable');
    // Typert validates positional arity even for optional business parameters.
    const result = await api[method](...args);
    if (!result.ok) throw new Error('AI Meter RPC failed');
    return result.value;
  };
  let generation=0;
  const caches=new Map<string,{value?:Overview;attempted:number;error?:unknown;inflight?:Promise<Overview>}>();
  const fetchUsage=(kind:'getPreview'|'getAllUsage',force=false):Promise<Overview>=>{
    let cache=caches.get(kind);if(!cache){cache={attempted:0};caches.set(kind,cache);}
    if(cache.inflight)return cache.inflight;
    if(!force && Date.now()-cache.attempted<15000){if(cache.error)return Promise.reject(cache.error);if(cache.value)return Promise.resolve(cache.value);}
    const entry=cache,version=generation;entry.attempted=Date.now();
    const method=force?'refresh':kind,args=method==='getPreview'?[]:[undefined];
    const pending=invoke(method,...args).then(overviewSchema.parse).then(value=>{if(version===generation){entry.value=value;entry.error=undefined;}return value;}).catch(error=>{if(version===generation)entry.error=error;throw error;}).finally(()=>{if(entry.inflight===pending)entry.inflight=undefined;});
    entry.inflight=pending;return pending;
  };
  const query=()=>fetchUsage('getAllUsage'),previewQuery=()=>fetchUsage('getPreview');
  const refresh=()=>{caches.delete('getPreview');return fetchUsage('getAllUsage',true);};
  const invalidate=(value:unknown)=>{generation++;caches.clear();return channelConfigurationSchema.parse(value);};
  const channels={
    getConfiguration:async()=>channelConfigurationSchema.parse(await invoke('getConfiguration')),
    saveConfiguration:async(input:ChannelSave)=>invalidate(await invoke('saveConfiguration',input)),
    setCredential:async(input:SecretSave)=>invalidate(await invoke('setCredential',input)),
    inspect:async(provider:ProviderId,account:string)=>snapshotSchema.parse(await invoke('testConnection',provider,account)),
    discoverLocal:async()=>await invoke('discoverLocal') as ProviderId[],
  };
  const props={query,refresh,channels,previewQuery};
  ctx.effect(() => {
    const tag = document.createElement('style'); tag.dataset.aiMeter=''; tag.textContent=styles; document.head.appendChild(tag);
    return () => tag.remove();
  });
  ctx.slots.inject('settings.section', () => ctx.slots.register({name:'settings.section', id:'ai-meter', order:42, label:()=>'AI Usage · 用量', inject:()=>props}, Dashboard));
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({name:'conversation.input.left',id:'ai-meter-chip',order:30,inject:()=>props},QuotaChip));
}
