# DSH AI Meter

[简体中文](README.md) | **English**

Unified AI provider usage, quota and balance monitor for DeepSeek Harness.

Track subscription windows, shared model pools, requests, credits and monetary balances as separate meters. Different accounts, currencies and quota windows are never added into one misleading total.

**Status: v0.1.0 developer preview; not published to npm.** Eight provider adapters, a DSH service/RPC API, an Agent tool, and usage/channel settings are implemented. Automated tests use synthetic responses. Integration has also been checked in a running DSH Web instance, with real output checks for several official CLIs. Each channel still needs authentication and connection validation on its execution machine; support does not imply coverage of every plan or upstream response format.

![Usage dashboard with synthetic data](docs/images/dashboard-demo.png)

Screenshots are illustrative, may lag behind the current UI, and contain no real account quotas.

## Supported providers

| Provider | Collected data | Source / prerequisite |
| --- | --- | --- |
| OpenCode Go | Rolling, weekly and monthly remaining percentages and resets | HTTP; `OPENCODE_GO_API_KEY` or the local OpenCode `opencode-go` API login entry |
| Volcengine ARK | Agent Plan / Coding Plan periods, personal and team plans | Official `arkcli usage plan`, local or SSH; CLI authentication and optional profile |
| MiniMax | Token Plan current period / weekly, boost, unlimited and unsupported entitlements; legacy Coding Plan request quotas | Official `mmx quota show`, local or SSH; alternatively HTTP with `MINIMAX_API_KEY` |
| Codex | Limit buckets, quota windows and supplemental credits | Official `codex app-server`, local or SSH; ChatGPT login on the execution machine |
| Antigravity | Gemini and Claude/GPT pool windows and resets | Official `agy --print /usage`, local or SSH; CLI authentication |
| Kimi | Coding short windows and weekly quota | HTTP; local Kimi Code login or `KIMI_CODE_ACCESS_TOKEN` |
| DeepSeek | API balance per currency | HTTP; `DEEPSEEK_API_KEY` |
| 302.AI | Balance, with currency left unknown if unavailable | HTTP; `AI_302_API_KEY` |

- **Settings → AI Usage · 用量** provides account details, progress bars, reset times, the lowest known percentage, filtering, refresh and channel management. The current UI primarily uses Chinese labels.
- Hover or focus the composer’s **用量** button for a compact preview; click it for a large **用量详情 / 配置渠道** (usage details / channel configuration) dialog. Touch users can click directly.
- **`query_ai_quota`** returns structured account meters and collection status to agents.
- Multiple accounts are supported, with independent Provider + account caches.
- `getAvailableProviders()` reports accounts that pass conservative quota checks. It does not automatically route model requests.

## Build and install

Requires Node.js 22+, npm, and an installed DSH environment with pnpm.

```sh
npm ci
npm run check
npm pack
```

Install the built package into your DSH Web profile, replacing the absolute path:

```sh
dsh plugin --profile web add /absolute/path/dsh-ai-meter/dsh-ai-meter-0.1.0.tgz
```

Restart your DSH Web process and open Settings → AI Usage. For local development, build first and register the directory:

```sh
dsh plugin --profile web add /absolute/path/dsh-ai-meter
```

Once the desired commit is available on GitHub, it can also be installed with `dsh plugin --profile web add github:percyc/dsh-ai-meter#<commit>`. This repository includes a `prepare` build script. If pnpm asks for dependency build permission, follow the DSH output and add the exact `allowBuilds` entry to the profile’s `pnpm-workspace.yaml`. A prebuilt tarball does not need an install-time build. See the [DSH plugin publishing guide](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md).

### Optional multi-plugin reload helper

The repository includes [reload-dsh.py](scripts/reload-dsh.py) and an [example configuration](scripts/reload-dsh.example.json). Configure your own DSH source path, profile and plugin catalog before using it; installing this plugin does not install the helper automatically.

```sh
reload-dsh --list
reload-dsh --plugins ai-meter --dry-run
reload-dsh --plugins ai-meter
reload-dsh --enable another-plugin
reload-dsh --disable another-plugin
```

Use comma-separated IDs to select multiple plugins. The helper remembers the last successful selection, rebuilds/registers selected plugins, and can restart the configured DSH process. Other plugins are optional. See [registration, reload and recovery details (Chinese)](docs/RELOAD_DSH.md).

## Channels and display settings

Open **用量 → 配置渠道**. The entry page lists existing channels with **validate, edit, enable/disable and delete** actions. Validation bypasses the cache for that account and reports its result without starting a recurring poll. Deletion requires inline confirmation and retains stored credentials.

Adding a channel follows four steps: **source → connection → query results → preview contents**. Existing channels can be edited directly through tabs. Newly added channels are excluded from the hover preview until you opt in.

Channels without a detected source are omitted from usage views. Explicitly saved channels remain available for repair even when credentials are missing. Errors, expired logins and stale results remain visible as states. Volcengine ARK always requires explicit channel creation; the other providers retain compatibility with existing default sources.

**Discover local sources** only checks for default credentials/login files or CLI executables. It does not query quota, validate authentication, add channels automatically or scan SSH hosts.

| Setting | Effect |
| --- | --- |
| Collection enabled | Disabling excludes the channel from preview, full details and Agent collection; configuration and credentials remain |
| Include in preview | Controls hover collection only; enabled channels remain available in full details and Agent queries |
| Display name | Distinguishes accounts and machines without changing the channel ID |
| Account identity label | Describes related sources; does not merge, deduplicate or provide failover |
| Channel order | Lower values appear first in the preview |
| Meter selection | Default meters exclude supplemental credits and unsupported entitlements; an explicit selection can include them |
| Meter aliases/order | Changes the preview only; details retain all meters and original names |

Omitting `meterIds` selects default meters, including future ordinary meters. An explicit list does not automatically include new IDs. `meterIds: []` shows no meters and prevents hover collection for that channel. Missing selected IDs are marked as awaiting a response rather than silently replaced.

Most upstream endpoints return all windows together. Hiding Weekly usually does not reduce the cost of one account query. Preview selection does not affect account health or routing: the complete original meters remain available as `assessmentMeters`.

### Preview and details

The preview combines provider and channel names, uses a dot for healthy status, and keeps text for anomalies. Each row contains a meter name, thin progress bar, remaining value and short reset date. Resets show a time today or month/day otherwise; hover or keyboard focus reveals the full date and countdown in the browser’s timezone. Narrow layouts wrap the date. Stale bars are gray, and each channel shows its last successful collection time.

The native modal dialog is up to 1440px wide and about 92% of viewport height. Background controls are inert while it is open, preventing host resize handles from covering the content. Escape, the close button and backdrop close the dialog and restore focus/scrolling.

![Compact preview with synthetic data](docs/images/preview-demo.png)

## Authentication and configuration

HTTP credentials are resolved on the **DSH server**, not the browser. A credential reference is resolved through `ctx.credentials.resolve(ref)`, then the server process environment as a fallback. The current local DSH credentials service resolves inherited environment variables, `.credentials.yaml`, the launch directory’s `.env`, then DSH home’s `.env`; the UI describes the detected source.

New HTTP channels default to a dedicated API Key / Access Token. Until one is saved, the channel is unconfigured and does not silently borrow a default key. Explicitly choosing existing credentials enables the default resolution path. Newly entered keys are stored in a channel-specific `DSH_AI_METER_<hash>` reference through authenticated DSH RPC, without replacing shared keys or CLI login files. Saved keys are not returned to the UI, stored in browser persistent storage, or included in query examples. Removing a channel does not delete its credential.

Channel settings are saved under the DSH `dsh-ai-meter` settings namespace. CLI authentication belongs to the execution machine’s CLI; the plugin does not copy its keys or remotely log in on your behalf. There is no configurable Cookie authentication, arbitrary Base URL, HTTP-over-SSH or free-form shell script collector.

For server-side configuration, the plugin row ID is `ai-meter`. This is a **config object**, not a complete patch file:

```yaml
cacheTtlMs: 120000
timeoutMs: 15000          # 100–60000; per-account deadline
lowQuotaPercent: 10
accounts:
  opencode-go:
    - id: personal
      name: Personal Go
      credentialEnv: OPENCODE_GO_API_KEY
      query: {kind: http, auth: auto}
      presentation:
        visible: true
        meterIds: [rolling, monthly]
  minimax:
    - id: cli
      query: {kind: cli, location: local}
  codex:
    - id: workstation
      name: Workstation Codex
      query:
        kind: cli
        location: ssh
        sshHost: workstation
        # executable: /absolute/path/codex  # Omit for automatic lookup
        # home: /home/me/.codex            # CODEX_HOME
      refreshIntervalSeconds: 300
      presentation: {visible: false}
  volcengine:
    - id: coding
      query: {kind: cli, location: local}
      arkProfile: my-profile     # Optional; otherwise CLI default/environment
      arkProduct: coding-plan   # Optional; otherwise discover subscriptions
      presentation: {visible: false}
  302ai: []                      # Disable this provider
```

`id` must be unique within a provider. A supplied account list replaces that provider’s defaults; `[]` disables it. Omitted providers use compatible default sources except Volcengine, which has no implicit account. `credentialEnv` is a reference name, **never the key itself**. An explicit reference prevents fallback to another local login file.

Prefer `query.executable` and `query.home` for CLI configuration. Codex also supports legacy `command/args/home`; AGY, mmx and arkcli use fixed quota commands and reject extra args. Codex home means `CODEX_HOME`; AGY/mmx/arkcli home means `HOME` / `USERPROFILE`, which cannot switch an OS user or keyring. OpenCode/Kimi’s legacy `home` controls local credential-file lookup.

### Local and SSH CLI execution

Codex, Antigravity, MiniMax CLI and Volcengine support both locations. Select SSH and enter an alias or `user@host` reachable from the DSH server. Reuse existing noninteractive SSH authentication and trusted host keys; the page does not store SSH passwords or private keys. Complete CLI login on the remote machine first.

With no executable override, lookup checks the remote noninteractive PATH, then obtains the login shell’s PATH, then checks `~/.local/bin`, `~/bin`, `~/.npm-global/bin`, `/home/linuxbrew/.linuxbrew/bin` and `/opt/homebrew/bin`. Login-script noise is filtered and lookup does not consume the CLI protocol’s stdin. An explicit executable is used exactly as configured; failed SSH queries never fall back to a local account.

Transport uses `ssh -T -a -x`, `BatchMode=yes`, `StrictHostKeyChecking=yes`, an 8-second connection timeout, keepalives, `ClearAllForwardings=yes` and `RemoteCommand=none`. Local processes run without a shell; remote arguments are individually POSIX-quoted. No terminal, agent forwarding or X11 forwarding is requested. Lookup and execution share the account deadline. The CLI may refresh its own authentication.

Validate each remote channel after setup. Offline transport tests cover quoting, noninteractive flags and all four supported protocols; they do not prove that a particular remote machine is reachable or authenticated.

## Refresh, caching and resource use

- **No usage UI open:** no background collection timer. Starting DSH or opening an ordinary chat page does not query quota. Explicit Agent calls and channel validation can still query it.
- **Hover/focus:** returns cache immediately and starts missing/expired preview channels. While this batch is pending, the UI reads progress every second with `collect=false`; these reads cannot start new collection. After completion, it stops. Remaining hovered beyond expiry does not start another batch; re-enter to check again.
- **Details visible:** checks on opening, then schedules checks by each channel’s `nextCheckAt`. Hidden browser tabs, the configuration panel and closed dialogs pause checks. Returning to the foreground checks again. Already requested or queued work finishes after closing.
- **Intervals:** HTTP defaults to 120 seconds; CLI/SSH to 300 seconds. `refreshIntervalSeconds` accepts integers from 30 to 3600. Global `cacheTtlMs` changes the HTTP default; CLI defaults remain five minutes. A sooner future reset can bring the next check forward; the plugin never assumes quota has refilled.
- **Storage:** browser instance memory holds results and a 15-second deduplication cache, bypassed when pending or due. Server process memory caches by Provider + account and deduplicates in-flight work across browsers on the same DSH instance. Nothing is persisted to disk. Page reload and server restart clear the respective layer.
- **Manual actions:** full-details refresh bypasses cache for all enabled channels; validation refreshes one account and invalidates browser usage caches. Concurrent requests for the same account still merge.
- **Concurrency:** at most three collectors run at once across HTTP, local CLI and SSH. Per-account timeout starts after obtaining a slot, defaulting to 15 seconds. UI results arrive progressively; aggregate Agent queries await completion.
- **Failures:** no immediate HTTP retry. The first failure waits one channel interval, consecutive failures double the delay up to 30 minutes, and success resets it. Manual refresh/validation bypasses backoff. Old data remains marked stale. A details RPC connection failure retries after 30 seconds; the preview does not persistently retry.

`fetchedAt` is the last successful collection time, `checkedAt` the latest attempt, `expiresAt` the freshness boundary, `nextCheckAt` the next collection/retry time, and `pending` indicates queued/running work. With no successful result, the UI explicitly says so, even though the snapshot has a fallback timestamp.

With details continuously open, default intervals imply roughly 30 HTTP or 12 CLI/SSH collections per account per hour, before runtime, backoff and resets. This is a collection-count estimate, not measured CPU, memory or bandwidth; a CLI may make multiple network requests internally. Closing all usage views stops automatic scheduled collection.

## Query commands and field mapping

These rules describe the current adapters, not a guarantee that every upstream interface is a stable public API. See [sources and references](docs/SOURCES.md). All collection runs on the DSH server or the explicitly configured SSH machine.

### HTTP verification with curl

Connection settings and query results provide copyable curl commands using the same endpoint definitions as the adapters. They reference `AI_METER_TOKEN`, which you must set in your terminal; they never embed a stored key or automatically resolve DSH credentials.

```sh
curl --request GET --silent --show-error --fail-with-body --max-time 15 \
  'https://opencode.ai/zen/go/v1/usage' \
  --header "Authorization: Bearer ${AI_METER_TOKEN}" \
  --header 'Accept: application/json'
```

All five direct HTTP adapters use GET, Bearer authentication, `Accept: application/json`, no body, fixed domains and no redirects. Substitute the endpoint below to reproduce other HTTP sources. Your terminal’s network environment may differ from the DSH server. CLI channels show their commands/protocol instead of a fabricated curl equivalent.

HTTP responses and CLI output are limited to 2 MiB. Missing or invalid numbers stay unknown, not zero/full. Existing remaining percentages are retained; otherwise a positive limit allows `remaining / limit × 100`, with derived percentages clamped to 0–100. If only used and limit exist, remaining is `max(0, limit - used)`. Balances without limits get no percentage. Numeric timestamps below `1e12` are seconds, larger ones milliseconds; supported dates normalize to ISO. Authentication, rate limiting, timeout and format errors are distinct from exhaustion. See [normalization](src/core/normalize.ts) and [shared HTTP handling](src/providers/shared.ts).

### OpenCode Go

- `GET https://opencode.ai/zen/go/v1/usage`; default reference `OPENCODE_GO_API_KEY`.
- Without an explicit reference or resolved default key, read `$XDG_DATA_HOME/opencode/auth.json` or `~/.local/share/opencode/auth.json`. Only the `opencode-go` entry with `type: "api"` and `key` is accepted. A configured home uses its `.local/share/opencode/auth.json`.
- Read `usage`, falling back to the top level. `rolling.percent`, `weekly.percent` and `monthly.percent` are **used percentages**: remaining = `100 - percent`. Each window’s `resetsAt` supplies its reset; top-level `plan` supplies its name.
- No hardcoded dollar limits. A synthetic weekly value of 57 means 43% remaining. No CLI subscription collector or Cookie mode; `opencode stats` is not Go subscription quota.

Implementation: [opencode-go.ts](src/providers/opencode-go.ts).

### Volcengine ARK

Provider ID: `volcengine`. Official arkcli **1.0.26** was checked against real local Coding Plan output. Add a channel explicitly and select the official CLI source.

```sh
npm i -g @volcengine/ark-cli
arkcli auth login
arkcli auth status --format json
arkcli usage plan --format json
# Optional fixed profile and product; does not switch the default profile:
arkcli usage plan --format json --product coding-plan --profile my-profile
```

Each collection first runs `auth status` with the same profile and requires `logged_in=true`. It neither auto-logs in nor reads/copies API keys. `arkProfile` is optional; otherwise the CLI environment/default applies. `arkProduct` accepts `agent-plan`, `coding-plan`, `agent-plan-team` or `coding-plan-team`; omission discovers subscribed plans, while an explicit product avoids subscription discovery. Team queries cover the current identity’s seat, not arbitrary seats.

Local and SSH execution set `ARKCLI_NO_UPDATE_NOTIFIER=1` to prevent implicit CLI upgrades during collection. Region, project and identity belong to the CLI profile. No arbitrary args, key or Base URL is passed.

| Response field | Interpretation |
| --- | --- |
| `items[].product` | Separate plan pool and meter ID prefix |
| `items[].subscribed=false` | Skip unsubscribed plan; no supported plans yields unsupported status |
| `periods[].label` | Recognize each period; `session` is “current period”, never assumed to mean 5h |
| `periods[].percent` | **Used percentage**; remaining = 100 − percent |
| `periods[].used` / `total` | Agent Plan absolute amounts use **AFP**, not tokens; positive totals allow counts and derived percentages |
| Missing Coding Plan counts | Percentage only; do not invent requests, tokens or cash balance |
| Explicit `total=0` | Unknown, not unlimited or 100% available |
| `periods[].reset_at` | RFC3339 normalized to UTC ISO, displayed in the browser’s timezone |
| `items[].error` | Preserve an unknown plan meter while retaining other successful plans; omit raw errors |

Viewer identity summaries, seat IDs and credentials do not enter snapshots. CLI `updated_at` does not replace the plugin’s collection timestamp. Plans remain separate.

This adapter provides **subscription quota snapshots**, not pay-as-you-go token statistics, cash balance or billing. It does not substitute `usage stats` for Coding Plan detail. Agent Plan per-model history, team admin seat overviews and free token bundles are outside its scope.

Implementation: [volcengine.ts](src/providers/volcengine.ts). [Official ARK CLI documentation](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2536875?lang=zh); commands and fields were checked against installed CLI help and bundled usage documentation.

### MiniMax

Choose official mmx CLI or HTTP; existing HTTP channels do not switch automatically. The [official CLI](https://github.com/MiniMax-AI/cli) was checked at **1.0.25**.

```sh
npm install -g mmx-cli
mmx auth login
# Exact collection command:
mmx quota show --non-interactive --quiet --output json
# Human-readable comparison:
mmx quota show
```

The CLI manages its own login, environment, region and plan on the local/SSH machine. The plugin does not read its credentials or pass DSH keys as arguments. HTTP region and legacy plan selections affect HTTP only. The CLI adapter currently parses Token Plan `model_remains`, not the separate pay-as-you-go balance response.

HTTP uses `MINIMAX_API_KEY`, with base `https://www.minimax.io` (global) or `https://www.minimaxi.com` (`region: cn`):

- `planType: token` (default): `GET /v1/token_plan/remains`.
- `planType: coding` (legacy): `GET /v1/api/openplatform/coding_plan/remains`.
- Nonzero `base_resp.status_code` is an error; 1004 is an authentication error. Each `model_remains[]` row has scope `model_name`.

| Window | Remaining percentage | Reset |
| --- | --- | --- |
| Current interval, named from `start_time` / `end_time` duration | `current_interval_remaining_percent` | `end_time` |
| Weekly | `current_weekly_remaining_percent` | `weekly_end_time` |

Token Plan interpretation follows the verified mmx rules, in this order:

1. If interval **and** weekly totals are both zero, and interval **and** weekly statuses are both 3, the entire pool is **not included in the plan**. A single 3 or zero is insufficient.
2. Otherwise, `current_weekly_status === 3` means **unlimited weekly quota** for that pool.
3. Finite windows use nonnegative remaining percentages. Finite weekly percentages also multiply by `weekly_boost_permille / 1000`, defaulting to 1 when absent. For example, 80 × 1500 / 1000 = 120%; text retains 120% while the bar caps at 100%. Zero Token Plan counters are not used as denominators.

Unlimited and unsupported meters use `entitlement: unlimited | unsupported` without fabricated numeric values or resets. They do not enter lowest-percentage ranking; an unsupported video pool does not exhaust an available general pool. Accounts with only unsupported meters are not routing candidates. Legacy `*-5h` meter IDs remain for saved selection compatibility even when an interval is 24h; unknown duration is named “current period”.

For legacy Coding Plan without percentages, `current_interval_usage_count` / `current_weekly_usage_count` mean **remaining requests**, with a positive corresponding total as the limit. Implementation: [minimax.ts](src/providers/minimax.ts).

### Codex

The plugin starts `codex app-server` for each uncached collection and stops it after the response or timeout. Authentication belongs to Codex; optional home is `CODEX_HOME`. There is no persistent app-server process or direct private HTTP backend call.

To reproduce, run on the configured machine as the same user:

```sh
codex app-server
# Or, for an explicitly configured login directory:
# CODEX_HOME='/absolute/path/.codex' codex app-server
```

Paste this single JSON line into the running process, not into a shell:

```json
{"id":1,"method":"initialize","params":{"clientInfo":{"name":"dsh-ai-meter","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}
```

Wait for a successful response with `id: 1`, then send these two lines:

```json
{"method":"initialized"}
{"id":2,"method":"account/rateLimits/read"}
```

The response for `id: 2` contains the quota in `result`. Ignore unrelated notifications; press Ctrl+C when finished. This requests subscription quota, not model generation. A model API key or proxy configuration alone does not imply a queryable ChatGPT subscription.

| Field | Mapping |
| --- | --- |
| `rateLimitsByLimitId` | Prefer nonempty bucket map; otherwise use `rateLimits`, never count both |
| Bucket `primary` / `secondary` | Independent windows, retaining the limit ID as scope |
| `usedPercent` | Remaining = 100 − usedPercent |
| `windowDurationMins` | 300 → 5h, 10080 → weekly; other durations remain in minutes |
| `resetsAt` | Unix-seconds reset timestamp |
| `credits.balance` | Supplemental credits if numeric and not unlimited; not currency or a subscription percentage |
| Top-level/bucket `planType` | Plan name |

When subscription windows exist, **zero supplemental credits does not mean the subscription is exhausted**. Credits are excluded from that account’s exhaustion assessment and hidden in the preview by default, but retained in details. A credits-only response is still assessed as a balance. Hiding an exhausted subscription window does not change health/routing.

Implementation: [codex.ts](src/providers/codex.ts). Protocol: [Codex App Server initialization and ChatGPT rate limits](https://learn.chatgpt.com/docs/app-server).

### Antigravity

Only the official AGY CLI is used, with its own authentication. No third-party `agy-quota` collector, copied OAuth credentials or reverse-engineered Code Assist request is required.

```sh
agy --print /usage
```

The official [headless documentation](https://antigravity.google/docs/cli/headless/#unsupported-messages) describes `/usage` as a directly handled command, separate from stream-json sessions. It does not ask a model to generate quota information. The interactive CLI also exposes [the usage panel](https://antigravity.google/docs/cli/commands/usage/).

Verified local output uses four tab-separated columns. The following values are synthetic; `<TAB>` denotes an actual tab:

```text
Gemini Models<TAB>Weekly Limit Remaining<TAB>92%<TAB>2099-01-01T00:00:00Z
Gemini Models<TAB>Five Hour Limit Remaining<TAB>100%<TAB>2099-01-01T00:00:00Z
Claude and GPT models<TAB>Weekly Limit Remaining<TAB>80%<TAB>2099-01-01T00:00:00Z
Claude and GPT models<TAB>Five Hour Limit Remaining<TAB>61%<TAB>2099-01-01T00:00:00Z
```

Columns are group, window, **remaining percentage** (used directly) and ISO reset. IDs are `gemini-weekly`, `gemini-5h`, `claude-gpt-weekly`, `claude-gpt-5h`. Pools stay independent, with no invented request totals, tokens or plan name. Missing fields, invalid percentages, duplicate windows or unknown text fail explicitly. CLI text formats may change with versions.

Local and SSH use the same command and their own login. Legacy third-party bridges and extra args are rejected; update the executable and reselect meters when migrating. No AGY settings or status bars are modified. Implementation: [antigravity.ts](src/providers/antigravity.ts).

### Kimi Coding

- `GET https://api.kimi.com/coding/v1/usages`; default reference `KIMI_CODE_ACCESS_TOKEN`.
- Without an explicit reference or resolved default token, read `access_token` from `~/.kimi-code/credentials/kimi-code.json`, then `~/.kimi/credentials/kimi-code.json`. A configured home changes the lookup root.
- `limits[].window.duration` / `timeUnit` define short windows. `detail.limit`, `used`, `remaining`, `resetTime` map to limit, usage, remaining and reset. Top-level `usage` maps to weekly using the same fields.
- Percentages derive from valid counts when needed. Quota units remain unknown, not assumed to be requests or tokens. No independent API balance or active OAuth refresh; log in again when expired.

Implementation: [kimi.ts](src/providers/kimi.ts).

### DeepSeek

`GET https://api.deepseek.com/user/balance`, using `DEEPSEEK_API_KEY`. Each `balance_infos[]` entry maps numeric `total_balance` to balance and preserves `currency`. Currencies stay separate; paid/promotional components are not added again. Negative values remain as reported. No percentage, reset or call history is fabricated. Implementation: [deepseek.ts](src/providers/deepseek.ts).

### 302.AI

`GET https://api.302.ai/dashboard/balance`, using `AI_302_API_KEY`. `data.balance` supplies the balance. There is no reliable currency field in the current parser, so USD is not assumed; no percentage or reset is generated. Implementation: [302ai.ts](src/providers/302ai.ts).

## Developer API

The DSH service is `ctx.aiMeter`; Typert wire endpoints use `aiMeter/<method>`.

| Method | Purpose |
| --- | --- |
| `getUsageView(preview, force, collect)` | Progressive UI cache/collection view with pending and next-check times; `collect=false` never starts collectors |
| `testConnection(provider, account)` | Force one account validation |
| `getPreview()` | Collect preview channels and project selected meters/aliases/order; not a routing API |
| `discoverLocal()` | Detect default local sources without quota calls or automatic creation |
| `getConfiguration()` | Nonsensitive settings, revision and credential provenance |
| `saveConfiguration(input)` | Save settings, reject stale revisions; does not accept raw keys |
| `setCredential(input)` | Store a dedicated account credential; return only nonsensitive configuration |
| `listProviders()` | Accounts and detected source availability, not proof of login validity |
| `getUsage(provider, account?)` | One snapshot; first account by default |
| `getAllUsage(filter?)` | Snapshots, lowest known percentage and threshold |
| `refresh(filter?)` | Force selected providers; concurrent calls still merge |
| `getHealth(filter?)` | Per-account collection and quota states |
| `getAvailableProviders(filter?)` | Accounts passing conservative quota checks |

`filter` is an array of IDs: `opencode-go`, `minimax`, `codex`, `antigravity`, `kimi`, `deepseek`, `302ai`, `volcengine`. Omission selects all; `[]` selects none. Agent tool example: `{"providers":["opencode-go","volcengine"]}`.

The core can be imported without loading DSH:

```ts
import { MeterRegistry, type QuotaProvider } from 'dsh-ai-meter/core'

// myProvider is your implementation of QuotaProvider.
const meter = new MeterRegistry({
  cacheTtlMs: 120_000,
  timeoutMs: 15_000,
  lowQuotaPercent: 10,
})
meter.register(myProvider as QuotaProvider)
const snapshots = await meter.getAllUsage()
const candidates = await meter.getAvailableProviders()
// Check model capabilities, cost and task requirements separately.
meter.dispose()
```

`QuotaMeter.kind` supports `window | requests | credits | balance | pool`, with separate units including Agent Plan `afp`. Percentages are optional; MiniMax boost can exceed 100%. See [types](src/core/types.ts), [architecture (Chinese)](docs/ARCHITECTURE.md) and [implementation plan (Chinese)](docs/PLAN.md).

`healthy` means known, relevant quota meters pass checks; it is not a provider SLA or a guarantee that a model call succeeds. Unknown/stale/failed data, passed resets without fresh data, and relevant exhausted or below-threshold meters exclude an account from routing candidates. Supplemental Codex credits follow the exception above. There is no currency conversion, cross-provider total or task-budget prediction.

## Validation and current limits

```sh
npm run check                         # Types, offline tests, build
npx playwright install chromium
npm run test:browser                  # Built client, interaction, responsive layouts
```

Synthetic fixtures are not bundled into the plugin. Host tests use real Cordis with a test tools service; browser tests use a DSH module-loader/RPC test boundary. Actual DSH Web query/refresh integration has also been checked. GitHub Actions runs both suites and package checks. Real credentials and local configuration should never be committed.

Not implemented: independent MiniMax/Kimi pay-as-you-go balances, native AGY multi-account OAuth management, Cookie collectors, automatic source deduplication/failover, history charts, automatic model routing, or the ARK extensions excluded above. Upstream protocol changes may require adapter updates. Reference attribution is recorded in [SOURCES.md](docs/SOURCES.md) and [NOTICE](NOTICE).

## License

[MIT](LICENSE) © 2026 percyc.
