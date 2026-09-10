import type { Health, QuotaMeter, QuotaSnapshot, Overview } from './types.js';

export function numeric(value: unknown): number | undefined {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}
export function percent(value: unknown): number | undefined {
  const n = numeric(value);
  return n !== undefined && n >= 0 && n <= 100 ? n : undefined;
}
export function label(value: unknown): string | undefined {
  return typeof value === 'string' ? value.replace(/[\x00-\x1f\x7f]/g, '').trim().slice(0, 160) || undefined : undefined;
}
export function iso(value: unknown): string | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return;
  const n = typeof value === 'number' ? value : /^\d+(\.\d+)?$/.test(value) ? Number(value) : undefined;
  const ms = n === undefined ? Date.parse(String(value)) : n < 1e12 ? n * 1000 : n;
  if (!Number.isFinite(ms)) return;
  const date = new Date(ms);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}
export function normalizeMeter(m: QuotaMeter): QuotaMeter {
  const result = { ...m };
  if (result.remaining === undefined && result.limit !== undefined && result.used !== undefined) {
    result.remaining = Math.max(0, result.limit - result.used);
  }
  if (result.remainingPercent === undefined && result.remaining !== undefined && result.limit !== undefined && result.limit > 0) {
    result.remainingPercent = Math.max(0, Math.min(100, result.remaining / result.limit * 100));
  }
  return result;
}
export function fresh(s: QuotaSnapshot, now = Date.now()): boolean {
  return s.status === 'ok' && now < Date.parse(s.expiresAt);
}
export function health(s: QuotaSnapshot, threshold = 10, now = Date.now()): Health {
  if (s.status !== 'ok') return s.status;
  if (!fresh(s, now)) return 'stale';
  // Passed reset times require an upstream refresh, never a locally invented refill.
  if (s.meters.some(m => m.resetAt && Date.parse(m.resetAt) <= now)) return 'unknown';
  if (s.meters.some(m => m.remainingPercent === 0 || (m.remaining !== undefined && m.remaining <= 0))) return 'exhausted';
  if (s.meters.some(m => m.remainingPercent !== undefined && m.remainingPercent < threshold)) return 'low';
  if (!s.meters.length || s.meters.some(m => m.remainingPercent === undefined && m.remaining === undefined)) return 'unknown';
  return 'healthy';
}
export function overview(snapshots: QuotaSnapshot[], now = Date.now(), lowQuotaPercent = 10): Overview {
  const candidates = snapshots.filter(s => fresh(s, now)).flatMap(s => s.meters
    .filter(m => m.remainingPercent !== undefined && (!m.resetAt || Date.parse(m.resetAt) > now))
    .map(m => ({provider: s.provider, account: s.account.name, meter: m.name, remainingPercent: m.remainingPercent!})));
  candidates.sort((a, b) => a.remainingPercent - b.remainingPercent);
  return {generatedAt: new Date(now).toISOString(), lowQuotaPercent, snapshots, lowest: candidates[0] ?? null};
}
