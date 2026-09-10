# Protocol references

Reviewed on 2026-09-09. This project implements its own core and adapter modules; references below informed API contracts and DSH integration. Provider response tests are synthetic fixtures, not recordings of user accounts.

| Source | Reviewed revision / interface | Used for |
| --- | --- | --- |
| [Volcengine ARK CLI](https://console.volcengine.com/ark/region:cn-beijing/docs/82379/2536875?lang=zh) | Local arkcli 1.0.26 help and bundled usage-plan reference, checked 2026-09-10 | Official auth status + usage plan, profile/product selection, used percent, AFP, RFC3339 reset; verified real Coding Plan output. Console page requires JS; protocol verified from installed CLI. |
| [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) | `5dda764ed3aa172535a7967b06ff95d9cbfe536a` | Cordis service, client module loader, settings.section, Typert and package bundle conventions |
| [dsh-ai-quota](https://github.com/Carrick-K7/dsh-ai-quota) | `1ae812666f1a09269d0e8ff9037130b626381eb2` | Community quota endpoint shapes and integration reference |
| [agy-quota](https://github.com/tingyi365/agy-quota) | `d750cb28b53190fb102ef4cd6634e189e996e9ae` | Historical prototype reference only; its bridge and JSON parser have been removed in favor of the official AGY CLI |
| [agy-usage](https://github.com/orrisroot/agy-usage) | README reviewed | Historical research only; not installed, integrated or planned as a runtime dependency |
| [MiniMax official CLI](https://github.com/MiniMax-AI/cli) | Installed mmx-cli 1.0.25, checked 2026-09-10 | Fixed `quota show --non-interactive --quiet --output json`; not-in-plan combined status/count predicate, weekly unlimited status=3, weekly boost permille; verified against local text and JSON output |
| [MiniMax Usage](https://github.com/Hukilow/Minimax-usage) | `07db29e02f8a66bf295be61d6f01ff36dd93a13a` | Current Token Plan `model_remains` and authoritative remaining-percent fields |
| [OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server) | `initialize`, `initialized`, `account/rateLimits/read` | Multi-bucket rate limits, Unix-second reset, optional credits; subscriptions, not platform API billing |
| [OpenCode Go](https://opencode.ai/docs/go/) | Go usage windows | Periodic quotas; no hard-coded monetary limits |
| [MiniMax CLI issue #70](https://github.com/MiniMax-AI/cli/issues/70) | Legacy Coding counter semantics | `usage_count` denotes remaining requests, not consumed requests |
| [MiniMax Token Plan FAQ](https://platform.minimax.io/docs/token-plan/faq) | Token Plan usage | Current plan support; fixed global/CN remains endpoints |
| [DeepSeek balance API](https://api-docs.deepseek.com/api/get-user-balance) | `GET /user/balance` | Currency and balance fields |

## Compatibility and confidence

DSH is a developer preview. Tests currently resolve Cordis `4.0.2`, schemastery `3.18.2`, DSH credentials/tools/typert-protocol `0.1.0-rc.8`, React `19.2.8`. The lockfile records exact versions; matching a newer monorepo source does not by itself prove compatibility with all published host versions.

OpenCode, Kimi and 302.AI adapter formats are based on the cited community implementation. MiniMax old Coding Plan deliberately treats `current_interval_usage_count` as remaining requests, unlike the current Token Plan percentage contract. These paths need real-account comparison against each provider's dashboard before a stable release.

The AGY bridge reuses an external program installed by the operator; it is not vendored. Its own protocol assumptions and OS credential support remain relevant. The adapter deduplicates explicitly shared pool scopes and retains partial-listing failures as unknown quota.

Current Antigravity runtime source: [official headless /usage](https://antigravity.google/docs/cli/headless/#unsupported-messages) and [official quota panel](https://antigravity.google/docs/cli/commands/usage/), checked 2026-09-10. Actual tab-separated `agy --print /usage` output was verified locally; its format is validated strictly rather than assumed to be a versioned JSON API.
