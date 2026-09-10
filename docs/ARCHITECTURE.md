# Architecture

```text
Settings / query_ai_quota / Router caller
                    │
         Cordis aiMeter / Typert RPC
                    │
      MeterRegistry ─── AsyncCache (provider + account)
                    │
    ┌───────────────┼──────────────────┐
HTTP adapters    Codex app-server    official agy --print /usage text
    │               │                  │
    └────── normalizers / typed meters ─┘
```

## Responsibilities

- `src/core/types.ts`: shared runtime schemas and TypeScript types. Meter kinds retain units, currency, reset, model/pool scope. Returned schemas strip extra properties at the boundary.
- `core/normalize.ts`: derives remaining/percentage only when a real denominator exists; evaluates freshness and conservative account readiness. No quota pricing or provider auth knowledge.
- `core/cache.ts`: per-account TTL and single-flight deduplication. Results are cloned to prevent one consumer changing another's cached quota.
- `core/registry.ts`: registration, deadline, cancellation, independent account failures, stale results, overview and readiness. Only normalized meter data is cached in memory, not API keys or raw responses.
- `providers/`: small independent adapter/parser pairs. HTTP calls use fixed HTTPS provider endpoints, reject redirects, limit body size and respect the collection deadline. Child processes use argv, no shell, bounded output and forced cancellation.
- `server/`: validated plugin configuration and host/client Typert descriptors generated from the same method list. Service is available without the tool registry; tool registration attaches when `tools` exists.
- `web/`: React Settings extension. Host descriptors are shared with the client; no host credential/file/process code is imported. Browser uses host RPC, not provider APIs.

## Authentication boundary

DSH credentials service resolves a credential reference first; host environment is a fallback. Config contains only the reference name. Local login stores are read only for providers whose credentials were not explicitly overridden. Raw exceptions, stdout error messages and HTTP response bodies never cross the RPC/tool boundary.

Codex and official agy own their authentication side effects, including any token refresh performed internally by their CLI. The plugin neither initiates login nor issues inference requests. A user-provided CLI path is executable configuration controlled by the host operator; it is not exposed as an Agent tool input.

## Freshness and failures

A successful snapshot has collection/check/expiry timestamps. A failed refresh retains the previous successful meters and `fetchedAt`, updates `checkedAt`, sets `status: stale`, and immediately expires the data. With no previous data, status is not-configured / unsupported / error. Failed results are briefly cached for the normal TTL to avoid hammering providers; manual refresh bypasses it.

The default cache lifetime is 120 seconds; stale values are never counted as route-ready. No automatic replenishment is inferred when reset time passes. The UI minimum considers only fresh, known percentages with future/unknown reset timestamps; it never converts a balance into a percentage.

## Future routing

v0.1 eligibility is intentionally conservative at account level: every returned meter must be known, fresh and above threshold. With different model-specific pools, a depleted pool excludes the entire account for now. A future model-aware policy should filter meter scopes using verified provider/model mappings, then combine quota evidence with capability, price and task estimates. No platform switching is performed here.

## Interactive configuration and conversation entry

The host registers the `dsh-ai-meter` settings namespace with the composition configuration as its base. Settings writes use expected revisions to reject stale editors. Web-editable fields include source location, supported authentication mode, CLI executable/home, MiniMax region/plan, collection enablement and independent presentation preferences. Existing server-only args and credential references are retained for unchanged account IDs. Credential writes use the host credentials capability with a deterministic, account-specific `DSH_AI_METER_` reference. Shared keys and CLI files are never overwritten. These two stores are not transactional: a failed settings write may leave a stored credential, so the UI instructs the user to reload and inspect after failure. Removing an account stops monitoring without deleting its credential.

Configuration reads expose source metadata, never stored values. New keys are accepted only by the write RPC and immediately cleared from the form after completion or error; they are not saved to browser storage. Codex/AGY authentication remains CLI-owned. The collapsed conversation chip performs no collection or polling. Hover/focus requests a preview once; a 15-second client cache and the per-account server TTL avoid repeated upstream calls. Normal UI queries always use getAllUsage, leaving cache decisions to the host across browser tabs. Only the visible usage details poll every 120 seconds; hidden documents and the configuration tab pause collection. Manual refresh alone bypasses TTL. The preview and large dialog are separate, and usage/configuration occupy separate tabs.

## Query and presentation isolation

`core/channel.ts` validates provider-compatible query templates and independent presentation fields. `getPreview()` filters accounts before collection, then projects the selected meter IDs/labels/order without mutating full snapshots or routing results. Missing selected IDs remain visible as missing metadata. Pure presentation/identity edits retain the collector cache; collection-affecting changes replace the registry. `discoverLocal()` checks only default local credentials/executable presence and never registers a channel or collects usage. New channels are excluded from preview until opted in. Legacy defaults remain compatible.

`core/methods.ts` supplies both HTTP adapter endpoints and user-facing query/metric explanations. CLI descriptions use saved configuration; legacy args are not echoed. `providers/command.ts` creates local argv or an OpenSSH transport with individually shell-quoted remote words, strict known-host checking, noninteractive authentication and no forwarding. SSH CLI authentication stays remote. Only Codex and AGY use SSH; arbitrary HTTP/Cookie/remote shell templates are not exposed. Browser preview and full-usage caches are separate and invalidated after configuration writes.

## Guided configuration

The configuration UI separates source selection, connection inputs, verification results and preview preferences. Secrets are entered only for the explicit HTTP Key mode; existing-credential mode describes its source instead. Saving and verifying serially commits configuration, optionally stores the key, then calls `testConnection` to bypass the account cache. Credential replacement rebuilds collection state even when the reference name stays the same. Advanced commands, field mappings and maintenance actions are collapsed. Unsaved edits must be saved or discarded before switching channels. No new provider authentication or CLI support is introduced by this UI change.
