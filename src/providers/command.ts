import type { AccountConfig } from './shared.js';
import { findCommand } from './shared.js';
import { MeterError } from '../core/errors.js';
import { querySchema } from '../core/channel.js';
export const shellQuote=(value:string)=>"'"+value.replace(/'/g,"'\\''")+"'";
export function commandPlan(a:AccountConfig,command:string,args:string[],homeVariable:'CODEX_HOME'|'HOME',environment:Record<string,string>={}) {
  const q=a.query?.kind==='cli'?querySchema.parse(a.query):undefined;
  const cli=q?.kind==='cli'?q:undefined;
  const executable=cli?.executable ?? command,home=cli?.home ?? a.home;
  if(executable.startsWith('-'))throw new MeterError('command-failed');
  if(cli?.location!=='ssh')return {command:executable,args,env:home?{...process.env,...environment,...(homeVariable==='HOME'?{HOME:home,USERPROFILE:home}:{CODEX_HOME:home})}:{...process.env,...environment}};
  // OpenSSH joins its remote command through a shell: quote each word, including configured paths.
  const assignments=[...Object.entries(environment).map(([key,value])=>`${key}=${value}`),...(home?[`${homeVariable}=${home}`]:[])];
  const words=assignments.length?['env',...assignments,executable,...args]:[executable,...args];
  if(words.some(v=>v.includes('\0')))throw new MeterError('command-failed');
  const direct='exec '+words.map(shellQuote).join(' ');
  // Discover only bare default commands. Explicit paths remain deterministic.
  const auto=!cli.executable && !executable.includes('/');
  const discovery=`
if ! command -v ${shellQuote(executable)} >/dev/null 2>&1; then
  dsh_meter_login_path=$("\${SHELL:-/bin/sh}" -lc 'printf "__DSH_METER_PATH_BEGIN__%s__DSH_METER_PATH_END__" "$PATH"' </dev/null 2>/dev/null) || :
  case "$dsh_meter_login_path" in
    *__DSH_METER_PATH_BEGIN__*__DSH_METER_PATH_END__*)
      dsh_meter_login_path=\${dsh_meter_login_path##*__DSH_METER_PATH_BEGIN__}
      PATH=\${dsh_meter_login_path%%__DSH_METER_PATH_END__*}; export PATH ;;
  esac
fi
if ! command -v ${shellQuote(executable)} >/dev/null 2>&1; then
  PATH="$HOME/.local/bin:$HOME/bin:$HOME/.npm-global/bin:/home/linuxbrew/.linuxbrew/bin:/opt/homebrew/bin:$PATH"; export PATH
fi
${direct}`;
  const remote=auto?'exec /bin/sh -c '+shellQuote(discovery):direct;
  return {command:'ssh',args:['-T','-a','-x','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=8','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=1','-o','ClearAllForwardings=yes','-o','RemoteCommand=none','--',cli.sshHost!,remote],env:process.env};
}
export async function executablePlan(a:AccountConfig,command:string,args:string[],homeVariable:'CODEX_HOME'|'HOME',environment:Record<string,string>={}){
  const plan=commandPlan(a,command,args,homeVariable,environment),executable=await findCommand(plan.command);
  if(!executable)throw new MeterError('not-installed');
  return {...plan,command:executable};
}
