import { z } from 'zod';
import type { ProviderId } from './types.js';
const text=z.string().min(1).max(512).refine(v=>!/[\x00-\x1f\x7f]/.test(v),'Control characters are not allowed');
export const querySchema=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('http'),auth:z.enum(['auto','api-key']).default('auto')}),
  z.object({kind:z.literal('cli'),location:z.enum(['local','ssh']),sshHost:z.string().regex(/^(?:[A-Za-z0-9_][A-Za-z0-9_.-]*@)?[A-Za-z0-9][A-Za-z0-9_.-]*$/).max(200).optional(),executable:text.refine(v=>!v.startsWith('-'),'Executable must not start with a dash').optional(),home:text.optional()}).superRefine((q,ctx)=>{if(q.location==='ssh' && !q.sshHost)ctx.addIssue({code:'custom',message:'SSH host is required',path:['sshHost']});}),
]);
export const presentationSchema=z.object({
  visible:z.boolean().default(true),order:z.number().int().min(-10000).max(10000).default(0),
  meterIds:z.array(z.string().min(1).max(160)).max(200).refine(ids=>new Set(ids).size===ids.length,'Duplicate metric').optional(),
  labels:z.record(z.string().max(160),z.string().max(160)).default({}),
});
export const channelFields={enabled:z.boolean().optional(),identity:z.string().max(160).optional(),query:querySchema.optional(),presentation:presentationSchema.optional()};
export type QueryConfig=z.infer<typeof querySchema>;
export type Presentation=z.infer<typeof presentationSchema>;
export interface ChannelOptions {enabled?:boolean;identity?:string;query?:QueryConfig;presentation?:Presentation}
export const cliProvider=(id:ProviderId)=>id==='codex'||id==='antigravity';
export function effectiveQuery(id:ProviderId,row:ChannelOptions):QueryConfig{return row.query ?? (cliProvider(id)?{kind:'cli',location:'local'}:{kind:'http',auth:'auto'});}
export function validateChannels(accounts:Partial<Record<ProviderId,ChannelOptions[]>>,ctx:z.RefinementCtx){
  for(const [provider,rows] of Object.entries(accounts))for(const [index,row] of (rows ?? []).entries()){
    if(row.query && (row.query.kind==='cli')!==cliProvider(provider as ProviderId))ctx.addIssue({code:'custom',path:[provider,index,'query'],message:'Query method is not supported for this provider'});
  }
}
