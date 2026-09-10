import { OpenCodeProvider } from './opencode-go.js';
import { MiniMaxProvider } from './minimax.js';
import { CodexProvider } from './codex.js';
import { AntigravityProvider } from './antigravity.js';
import { KimiProvider } from './kimi.js';
import { DeepSeekProvider } from './deepseek.js';
import { AI302Provider } from './302ai.js';
import type { ProviderId } from '../core/types.js';
import type { AccountConfig, ResolveSecret } from './shared.js';
export function createProviders(accounts: Partial<Record<ProviderId, AccountConfig[]>>, resolve: ResolveSecret) {
  return [OpenCodeProvider, MiniMaxProvider, CodexProvider, AntigravityProvider, KimiProvider, DeepSeekProvider, AI302Provider].map(Provider => {
    const id = new Provider([], resolve).id;
    return new Provider((accounts[id] ?? [{id:'default', name:'Default'}]).filter(a=>a.enabled!==false), resolve);
  }).filter(p => (accounts[p.id] ?? [{id:'default'}]).some(a=>a.enabled!==false));
}
