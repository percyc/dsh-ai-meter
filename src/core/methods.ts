import type { ProviderId, QuotaMeter } from './types.js';
import { effectiveQuery, type ChannelOptions } from './channel.js';
type MethodAccount=ChannelOptions & {region?:'global'|'cn';planType?:'token'|'coding';command?:string;args?:string[];home?:string};
export function httpEndpoint(id:ProviderId,a:MethodAccount={}){
  switch(id){
    case 'opencode-go':return 'https://opencode.ai/zen/go/v1/usage';
    case 'minimax':return (a.region==='cn'?'https://www.minimaxi.com':'https://www.minimax.io')+(a.planType==='coding'?'/v1/api/openplatform/coding_plan/remains':'/v1/token_plan/remains');
    case 'kimi':return 'https://api.kimi.com/coding/v1/usages';
    case 'deepseek':return 'https://api.deepseek.com/user/balance';
    case '302ai':return 'https://api.302.ai/dashboard/balance';
    default:return '';
  }
}
// Generated only from fixed provider endpoints; never accepts a credential value.
export function httpCurl(id:ProviderId,a:MethodAccount={}){
  if(effectiveQuery(id,a).kind!=='http')return undefined;
  const endpoint=httpEndpoint(id,a);
  if(!endpoint)return undefined;
  return [
    "curl --request GET --silent --show-error --fail-with-body --max-time 15 \\",
    `  '${endpoint}' \\`,
    '  --header "Authorization: Bearer ${AI_METER_TOKEN}" \\',
    "  --header 'Accept: application/json'",
  ].join('\n');
}
export function queryDescription(id:ProviderId,a:MethodAccount){
  const q=effectiveQuery(id,a);
  if(q.kind==='http')return `DSH 服务端 GET ${httpEndpoint(id,a)}；Authorization: Bearer <凭据引用>。${q.auth==='auto'?'复用已有凭据；OpenCode/Kimi 可回退到本机登录文件。':'使用此渠道保存的 API Key / Access Token，不回退读取本机登录文件。'} Cookie 查询尚未验证，当前不可用。`;
  if(id==='minimax')return `${q.location==='ssh'?`SSH 主机 ${q.sshHost}`:'DSH 本机'}：${q.executable ?? 'mmx'} quota show --non-interactive --quiet --output json。${q.home?`HOME=${q.home}。`:''}使用执行机器上 mmx 自有登录、区域和套餐配置；插件不读取 CLI 凭据文件。可执行文件留空时通过 PATH 查找，SSH 还检查登录 Shell PATH 和常见安装目录。解析 model_remains，与 HTTP Token Plan 共用规则；按量 API 余额暂不支持。官方工具：https://github.com/MiniMax-AI/cli。`;
  const executable=q.executable ?? a.command ?? (id==='codex'?'codex':'agy');
  const home=q.home ?? a.home;
  const command=`${executable}${a.args?.length?' <服务端预设参数不回显>':''} ${id==='codex'?'app-server':'--print /usage'}`;
  return `${q.location==='ssh'?`SSH 主机 ${q.sshHost}`:'DSH 本机'}：${command}。${home?`${id==='codex'?'CODEX_HOME':'HOME'}=${home}。`:''}${id==='codex'?`手动复现：在上述执行机器、同一用户和登录目录启动该命令，然后向运行中的进程逐行粘贴 JSON（每行回车）：
① {"id":1,"method":"initialize","params":{"clientInfo":{"name":"dsh-ai-meter","version":"0.1.0"},"capabilities":{"experimentalApi":true}}}
等待 id=1 的 result 后，依次输入：
② {"method":"initialized"}
③ {"id":2,"method":"account/rateLimits/read"}
id=2 的 result 即原始额度；剩余%=100−usedPercent。查完 Ctrl+C。详细示例见 README 的 Codex 小节。
`:'直接执行官方 agy --print /usage，读取制表符分隔的文本行：账号模型组、额度周期、剩余百分比、ISO 重置时间。该 /usage 由 CLI 本身处理，不是模型推理。官方说明：https://antigravity.google/docs/cli/headless/。不接受旧版第三方桥接参数。'} 使用执行机器上 CLI 的已有登录。${q.location==='ssh'?'可执行文件留空时先查远端默认 PATH，缺失时读取登录 Shell 的 PATH，仍缺失则检查 ~/.local/bin、~/bin、~/.npm-global/bin 和 Homebrew 常见目录；手动路径不自动替换。SSH 使用本机配置/agent，禁止交互密码与自动接受未知主机密钥；远端需提供 POSIX shell。':''}`;
}
export function meterDescription(id:ProviderId,m:QuotaMeter){
  switch(id){
    case 'opencode-go':return `usage.${m.id}.percent 是已用百分比，剩余 = 100 − percent；resetsAt 是重置时间。`;
    case 'minimax':return `model_remains[] 按 model_name 对应账号池；${m.name.endsWith('Weekly')?'current_weekly':'current_interval'}_remaining_percent 为剩余百分比。两周期 total_count=0 且两周期 status=3 表示不在当前套餐中；除此之外 current_weekly_status=3 表示周额度无限。有限周额度乘 weekly_boost_permille/1000（缺失按 1），不为无限或未包含指标显示百分比或重置时间。旧 Coding Plan 缺失百分比时 usage_count 表示剩余请求数，total_count 为总额。`;
    case 'codex':return m.kind==='credits'?'对应 limit bucket 的 credits.balance；unlimited=true 时不展示数值余额。':`对应 limit bucket 的 ${m.id.endsWith('secondary')?'secondary':'primary'}.usedPercent；剩余 = 100 − usedPercent，windowDurationMins 表示周期，resetsAt 表示重置时间。优先 rateLimitsByLimitId，兼容 rateLimits。`;
    case 'antigravity':return '官方 agy --print /usage 每行四列：模型组、周期、剩余百分比、重置时间。百分比已经是剩余值，不再执行 100 − value；模型组独立计量，按原样保留 5h / weekly。';
    case 'kimi':return `${m.id==='weekly'?'usage':'limits[].detail'} 的 remaining / limit × 100；缺 remaining 时由 limit − used 推导。resetTime 为 reset，窗口由 duration/timeUnit 定义；单位保留未知。`;
    case 'deepseek':return 'balance_infos[] 按 currency 取 total_balance；币种独立，不生成百分比。';
    case '302ai':return 'data.balance 作为余额；接口未确认币种，不默认 USD，不生成百分比。';
  }
}
