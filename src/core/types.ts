import { z } from 'zod';

export const providerIdSchema = z.enum(['opencode-go', 'minimax', 'codex', 'antigravity', 'kimi', 'deepseek', '302ai', 'volcengine']);
export type ProviderId = z.infer<typeof providerIdSchema>;
const number = z.number().finite();
const label = z.string().max(160);
export const meterSchema = z.object({
  id: label, name: label,
  kind: z.enum(['window', 'requests', 'credits', 'balance', 'pool']),
  unit: z.enum(['percent', 'requests', 'credits', 'money', 'tokens', 'afp', 'unknown']),
  entitlement: z.enum(['unlimited', 'unsupported']).optional(),
  used: number.nonnegative().optional(), limit: number.nonnegative().optional(),
  remaining: number.optional(), remainingPercent: number.min(0).optional(),
  currency: label.optional(), resetAt: z.iso.datetime().optional(),
  scope: label.optional(), models: z.array(label).optional(),
});
export type QuotaMeter = z.infer<typeof meterSchema>;
export const accountSchema = z.object({id: label, name: label});
export type Account = z.infer<typeof accountSchema>;
export const statusSchema = z.enum(['ok', 'not-configured', 'unsupported', 'error', 'stale']);
export const errorCodeSchema = z.enum(['not-configured', 'not-installed', 'unauthorized', 'rate-limited', 'timeout', 'network', 'invalid-response', 'upstream', 'command-failed', 'unsupported']);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export const snapshotSchema = z.object({
  provider: providerIdSchema, account: accountSchema, status: statusSchema,
  plan: label.optional(), meters: z.array(meterSchema),
  missingMeters:z.array(label).optional(),
  assessmentMeters:z.array(meterSchema).optional(),
  pending:z.boolean().optional(), nextCheckAt:z.iso.datetime().optional(),
  fetchedAt: z.iso.datetime(), checkedAt: z.iso.datetime(), expiresAt: z.iso.datetime(),
  source: label, error: errorCodeSchema.optional(),
});
export type QuotaSnapshot = z.infer<typeof snapshotSchema>;
export interface ProviderUsage { meters: QuotaMeter[]; plan?: string; source: string }
export interface QuotaProvider {
  id: ProviderId;
  name: string;
  detect(): Promise<boolean>;
  getAccounts(): Promise<Account[]>;
  getUsage(account: string, signal: AbortSignal): Promise<ProviderUsage>;
}
export const healthSchema = z.enum(['healthy', 'low', 'exhausted', 'unknown', 'stale', 'error', 'not-configured', 'unsupported']);
export type Health = z.infer<typeof healthSchema>;
export const overviewSchema = z.object({
  generatedAt: z.iso.datetime(), lowQuotaPercent: number.min(0).max(100), snapshots: z.array(snapshotSchema),
  lowest: z.object({provider: providerIdSchema, account: label, meter: label, remainingPercent: number}).nullable(),
});
export type Overview = z.infer<typeof overviewSchema>;
