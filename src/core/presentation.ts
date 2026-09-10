import type { AccountConfig } from '../providers/shared.js';
import type { Overview, ProviderId } from './types.js';
import { overview } from './normalize.js';
export type AccountMap=Partial<Record<ProviderId,AccountConfig[]>>;
export function previewIncluded(accounts:AccountMap,provider:ProviderId,account:string){
  const row=accounts[provider]?.find(r=>r.id===account);
  return row?.enabled!==false && row?.presentation?.visible!==false && row?.presentation?.meterIds?.length!==0;
}
export function projectPreview(value:Overview,accounts:AccountMap):Overview{
  const rows=value.snapshots.filter(s=>previewIncluded(accounts,s.provider,s.account.id)).map(s=>{
    const row=accounts[s.provider]?.find(r=>r.id===s.account.id),p=row?.presentation;
    const selected=p?.meterIds,labels=p?.labels ?? {};
    const meters=selected?selected.flatMap(id=>{const m=s.meters.find(m=>m.id===id);return m?[m]:[];}):s.meters;
    const missingMeters=selected?.filter(id=>!s.meters.some(m=>m.id===id)).map(id=>labels[id] || id);
    return {...s,meters:meters.map(m=>({...m,name:labels[m.id] || m.name})),...(missingMeters?.length?{missingMeters}:{}),order:p?.order ?? 0};
  }).sort((a,b)=>a.order-b.order).map(({order,...row})=>row);
  return overview(rows,Date.now(),value.lowQuotaPercent);
}
