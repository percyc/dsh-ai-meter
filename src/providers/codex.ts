import { executablePlan, commandPlan } from './command.js';
import type { AccountConfig } from './shared.js';
import { spawn } from 'node:child_process';
import { BaseProvider, MAX_BYTES, findCommand, object } from './shared.js';
import { iso, label, numeric, percent } from '../core/normalize.js';
import { MeterError } from '../core/errors.js';
import type { ProviderUsage, QuotaMeter } from '../core/types.js';
export function parseCodex(value: unknown): ProviderUsage {
  const root = object(value), map = object(root.rateLimitsByLimitId);
  const entries = Object.keys(map).length ? Object.entries(map) : root.rateLimits ? [['codex', root.rateLimits] as const] : [];
  const meters: QuotaMeter[] = [];
  let plan = label(root.planType);
  for (const [key, raw] of entries) {
    const bucket = object(raw), scope = label(key) ?? 'codex';
    plan ??= label(bucket.planType);
    for (const slot of ['primary', 'secondary']) {
      if (!bucket[slot]) continue;
      const w = object(bucket[slot]), minutes = numeric(w.windowDurationMins), used = percent(w.usedPercent);
      const window = minutes === 300 ? '5h' : minutes === 10080 ? 'Weekly' : minutes ? `${minutes}m` : slot;
      meters.push({id:`${scope}-${slot}`, name:`${scope} · ${window}`, kind:'window', unit:'percent', scope,
        remainingPercent:used === undefined ? undefined : 100-used, resetAt:iso(w.resetsAt)});
    }
    const credits = object(bucket.credits), remaining = numeric(credits.balance);
    if (remaining !== undefined && credits.unlimited !== true) meters.push({id:`${scope}-credits`, name:`${scope} · Credits`, kind:'credits', unit:'credits', scope, remaining});
  }
  if (!meters.length) throw new MeterError('unsupported');
  return {source:'Codex app-server account/rateLimits/read', plan, meters};
}
export async function codexRateLimits(command: string, args: string[], signal: AbortSignal, home?: string, account:AccountConfig={id:'default'}): Promise<unknown> {
  const plan = await executablePlan({...account,home},command,[...args,'app-server'],'CODEX_HOME');
  if (signal.aborted) throw new MeterError('timeout');
  return new Promise((resolve, reject) => {
    const child = spawn(plan.command, plan.args, {stdio:['pipe','pipe','pipe'], windowsHide:true,
      env:plan.env});
    let done = false, bytes = 0, buffer = '', phase = 1;
    function finish(error?: MeterError, value?: unknown) {
      if (done) return;
      done = true;
      signal.removeEventListener('abort', abort);
      child.kill('SIGKILL');
      child.stdin.destroy();
      error ? reject(error) : resolve(value);
    }
    function abort() { finish(new MeterError('timeout')); }
    signal.addEventListener('abort', abort, {once:true});
    if (signal.aborted) { abort(); return; }
    child.on('error', () => finish(new MeterError('command-failed')));
    child.on('close', () => finish(new MeterError('command-failed')));
    child.stdin.on('error', () => finish(new MeterError('command-failed')));
    child.stderr.on('data', () => {});
    child.stdout.setEncoding('utf8');
    const send = (msg: unknown) => child.stdin.write(JSON.stringify(msg) + '\n');
    child.stdout.on('data', (chunk: string) => {
      bytes += Buffer.byteLength(chunk); buffer += chunk;
      if (bytes > MAX_BYTES) return finish(new MeterError('invalid-response'));
      let pos: number;
      while (!done && (pos = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, pos); buffer = buffer.slice(pos + 1);
        let msg: Record<string, unknown>;
        try { msg = object(JSON.parse(line)); } catch { return finish(new MeterError('invalid-response')); }
        if (msg.id !== phase) continue;
        if (msg.error || !msg.result) return finish(new MeterError('upstream'));
        if (phase === 1) {
          phase = 2;
          send({method:'initialized'});
          send({id:2, method:'account/rateLimits/read'});
        } else finish(undefined, msg.result);
      }
    });
    send({id:1, method:'initialize', params:{clientInfo:{name:'dsh-ai-meter', version:'0.1.0'}, capabilities:{experimentalApi:true}}});
  });
}
export class CodexProvider extends BaseProvider {
  id = 'codex' as const; name = 'Codex';
  async detect() { return (await Promise.all(this.accounts.map(a => findCommand(commandPlan(a,a.command ?? 'codex',[],'CODEX_HOME').command)))).some(Boolean); }
  async getUsage(id: string, signal: AbortSignal) {
    const a = this.account(id);
    return parseCodex(await codexRateLimits(a.command ?? 'codex', a.args ?? [], signal, a.home, a));
  }
}
