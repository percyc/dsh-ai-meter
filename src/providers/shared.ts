import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { MeterError } from '../core/errors.js';
import type { ChannelOptions } from '../core/channel.js';
import type { Account, ProviderId, ProviderUsage, QuotaProvider } from '../core/types.js';

export interface AccountConfig extends ChannelOptions {
  id: string; name?: string; credentialEnv?: string;
  region?: 'global' | 'cn'; planType?: 'token' | 'coding';
  command?: string; args?: string[]; home?: string;
}
export type ResolveSecret = (name: string) => Promise<string | undefined>;
export const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
export const MAX_BYTES = 2 * 1024 * 1024;
export async function readJson(file: string): Promise<Record<string, unknown>> {
  try {
    const data = await readFile(file, 'utf8');
    if (Buffer.byteLength(data) > MAX_BYTES) return {};
    return object(JSON.parse(data));
  } catch { return {}; }
}
export async function findCommand(command: string): Promise<string | undefined> {
  const candidates = isAbsolute(command) || command.includes('/') || command.includes('\\') ? [command] :
    (process.env.PATH ?? '').split(delimiter).filter(Boolean).flatMap(dir => process.platform === 'win32' ? [join(dir, command + '.exe'), join(dir, command)] : [join(dir, command)]);
  for (const file of candidates) {
    try { await access(file, constants.X_OK); return file; } catch { /* next */ }
  }
}
export async function runText(command: string, args: string[], signal: AbortSignal, home?: string, environment?:NodeJS.ProcessEnv): Promise<string> {
  const executable = await findCommand(command);
  if (!executable) throw new MeterError('not-installed');
  return new Promise((resolve, reject) => {
    execFile(executable, args, {signal, maxBuffer:MAX_BYTES, timeout:30_000, killSignal:'SIGKILL', windowsHide:true,
      env:environment ?? (home ? {...process.env, HOME:home, USERPROFILE:home} : process.env)}, (err, stdout) => {
      if (err) return reject(new MeterError(signal.aborted ? 'timeout' : 'command-failed'));
      resolve(stdout);
    });
  });
}
export async function runJson(command:string,args:string[],signal:AbortSignal,home?:string,environment?:NodeJS.ProcessEnv):Promise<unknown>{
  const output=await runText(command,args,signal,home,environment);
  try{return JSON.parse(output);}catch{throw new MeterError('invalid-response');}
}
export async function requestJson(url: string, key: string, signal: AbortSignal): Promise<unknown> {
  let response: Response;
  try { response = await fetch(url, {headers:{Authorization:`Bearer ${key}`, Accept:'application/json'}, signal, redirect:'error'}); }
  catch { throw new MeterError(signal.aborted ? 'timeout' : 'network'); }
  if (!response.ok) {
    await response.body?.cancel();
    throw new MeterError(response.status === 401 || response.status === 403 ? 'unauthorized' : response.status === 429 ? 'rate-limited' : 'upstream');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new MeterError('invalid-response');
  let size = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) throw new MeterError('invalid-response');
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new MeterError('invalid-response'); }
  } catch (e) {
    if (signal.aborted) throw new MeterError('timeout');
    throw e instanceof MeterError ? e : new MeterError('network');
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export abstract class BaseProvider implements QuotaProvider {
  abstract id: ProviderId;
  abstract name: string;
  constructor(protected accounts: AccountConfig[], protected resolveSecret: ResolveSecret) {}
  async getAccounts(): Promise<Account[]> { return this.accounts.map(a => ({id:a.id, name:a.name ?? a.id})); }
  protected account(id: string) {
    const a = this.accounts.find(a => a.id === id);
    if (!a) throw new MeterError('not-configured');
    return a;
  }
  protected async key(a: AccountConfig, defaultEnv: string): Promise<string | undefined> {
    if(a.query?.kind==='http' && a.query.auth==='api-key' && !a.credentialEnv)return undefined;
    return this.resolveSecret(a.credentialEnv ?? defaultEnv);
  }
  protected requireKey(key: string | undefined): string { if (!key) throw new MeterError('not-configured'); return key; }
  abstract detect(): Promise<boolean>;
  abstract getUsage(account: string, signal: AbortSignal): Promise<ProviderUsage>;
}
export const accountHome = (a: AccountConfig) => a.home ?? homedir();
