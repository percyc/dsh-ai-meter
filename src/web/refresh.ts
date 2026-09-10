import type { Overview } from '../core/types.js';
// Pending jobs are polled only while a view remains visible; otherwise check the next due channel.
export function nextCheckDelay(value:Overview, now=Date.now()):number|undefined {
  if(value.snapshots.some(s=>s.pending))return 1000;
  const times=value.snapshots.map(s=>Date.parse(s.nextCheckAt ?? s.expiresAt)).filter(Number.isFinite);
  if(!times.length)return undefined;
  return Math.max(1000,Math.min(...times)-now+50);
}
export function dataAge(fetchedAt:string,now:number){
  const seconds=Math.max(0,Math.floor((now-Date.parse(fetchedAt))/1000));
  return seconds<60?'刚刚':seconds<3600?`${Math.floor(seconds/60)} 分钟前`:`${Math.floor(seconds/3600)} 小时前`;
}
