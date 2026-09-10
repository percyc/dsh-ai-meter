import s from '@deepseek-ai/schemastery';
import { z } from 'zod';
import { channelFields, validateChannels } from '../core/channel.js';
import { providerIdSchema } from '../core/types.js';

const account = z.object({
  ...channelFields,
  id:z.string().min(1).max(80), name:z.string().max(160).optional(),
  credentialEnv:z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/).optional(),
  region:z.enum(['global','cn']).optional(), planType:z.enum(['token','coding']).optional(),
  command:z.string().min(1).optional(), args:z.array(z.string()).optional(), home:z.string().min(1).optional(),
});
export const configSchema = z.object({
  cacheTtlMs:z.number().int().min(1000).max(3600000).default(120000),
  timeoutMs:z.number().int().min(100).max(60000).default(15000),
  lowQuotaPercent:z.number().min(0).max(100).default(10),
  accounts:z.partialRecord(providerIdSchema,z.array(account).max(30).refine(rows => new Set(rows.map(a => a.id)).size === rows.length, 'Duplicate account id')).superRefine(validateChannels).default({}),
});
export type MeterConfig = z.infer<typeof configSchema>;
export const Config = s.object({
  cacheTtlMs:s.number().default(120000).description('Cache lifetime in milliseconds.'),
  timeoutMs:s.number().default(15000).description('Per-account collection deadline in milliseconds.'),
  lowQuotaPercent:s.number().default(10).description('Below this remaining percentage, exclude from routing candidates.'),
  accounts:s.any().description('Provider account lists; use credential names, never raw keys. See README.').default({}),
});
