import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { commandPlan } from '../src/providers/command.js';
import { codexRateLimits, parseCodex } from '../src/providers/codex.js';
import { AntigravityProvider } from '../src/providers/antigravity.js';
const exec=promisify(execFile);
test('SSH plan quotes remote words and enforces noninteractive host verification',async()=>{
  const home="/tmp/home ' $(echo BAD)";
  const code='process.stdout.write(JSON.stringify({args:process.argv.slice(1),home:process.env.CODEX_HOME}))';
  const plan=commandPlan({id:'r',query:{kind:'cli',location:'ssh',sshHost:'me@workstation',home}},process.execPath,['-e',code,'--',"literal ' $(echo BAD)"],'CODEX_HOME');
  assert.equal(plan.command,'ssh');assert.ok(plan.args.includes('BatchMode=yes'));assert.ok(plan.args.includes('StrictHostKeyChecking=yes'));assert.ok(plan.args.includes('ClearAllForwardings=yes'));
  const {stdout}=await exec('/bin/sh',['-c',plan.args.at(-1)!]);
  assert.deepEqual(JSON.parse(stdout),{args:["literal ' $(echo BAD)"],home});
});
test('Codex and AGY run through SSH transport using remote CLI names, not local executables',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'meter-ssh-')),previous=process.env.PATH;
  try{
    await writeFile(join(dir,'ssh'),`#!${process.execPath}\nconst cmd=process.argv.at(-1);if(!process.argv.includes('StrictHostKeyChecking=yes') || !process.argv.includes('workstation'))process.exit(1);if(cmd.includes("agy")){if((!cmd.includes("--print") || !cmd.includes("/usage")))process.exit(2);process.stdout.write('Gemini Models\\tWeekly Limit Remaining\\t70%\\t2099-01-01T00:00:00Z\\n');}else{const rl=require('node:readline').createInterface({input:process.stdin});rl.on('line',line=>{const m=JSON.parse(line);if(m.id)process.stdout.write(JSON.stringify({id:m.id,result:m.method==='initialize'?{}:{rateLimits:{primary:{usedPercent:25}}}})+'\\n');});}`,{mode:0o755});
    process.env.PATH=dir;
    const query={kind:'cli' as const,location:'ssh' as const,sshHost:'workstation'};
    assert.equal(parseCodex(await codexRateLimits('remote-only-codex',[],AbortSignal.timeout(2000),undefined,{id:'r',query})).meters[0].remainingPercent,75);
    const agy=new AntigravityProvider([{id:'r',query}],async()=>undefined);
    assert.equal((await agy.getUsage('r',AbortSignal.timeout(2000))).meters[0].remainingPercent,70);
  }finally{process.env.PATH=previous;await rm(dir,{recursive:true,force:true});}
});

test('SSH automatic PATH discovery ignores login noise and preserves protocol stdin',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'meter-login-'));
  try{
    await writeFile(join(dir,'meter-cli'),"#!/bin/sh\nprintf '%s\\n' \"$PATH\" \"$1\"\n/bin/cat\n",{mode:0o755});
    await writeFile(join(dir,'login-shell'),`#!/bin/sh\nprintf 'login startup noise\\n'\nPATH='${dir}:/usr/bin:/bin'; export PATH\nexec /bin/sh "$@"\n`,{mode:0o755});
    const plan=commandPlan({id:'r',query:{kind:'cli',location:'ssh',sshHost:'host'}},'meter-cli',['literal $(no-execution)'],'HOME');
    const stdout=await new Promise<string>((resolve,reject)=>{const child=execFile('/bin/sh',['-c',plan.args.at(-1)!],{env:{...process.env,PATH:'/usr/bin:/bin',SHELL:join(dir,'login-shell')}},(err,out)=>err?reject(err):resolve(out));child.stdin!.end('protocol input\n');});
    assert.ok(stdout.split('\n')[0].split(':').includes(dir));
    assert.equal(stdout.split('\n').slice(1).join('\n'),'literal $(no-execution)\nprotocol input\n');
    assert.ok(!stdout.includes('login startup noise'));
    const manual=commandPlan({id:'r',query:{kind:'cli',location:'ssh',sshHost:'host',executable:'/missing/meter-cli'}},'meter-cli',[],'HOME');
    assert.ok(!manual.args.at(-1)!.includes('DSH_METER_PATH'));
    await assert.rejects(exec('/bin/sh',['-c',manual.args.at(-1)!]));
  }finally{await rm(dir,{recursive:true,force:true});}
});

test('SSH finds user-local CLI even when login shell does not supply its path',async()=>{
  const home=await mkdtemp(join(tmpdir(),'meter-local-bin-'));
  try{
    await mkdir(join(home,'.local','bin'),{recursive:true});
    await writeFile(join(home,'.local','bin','meter-local-cli'),'#!/bin/sh\nprintf "found-local\\n"\n/bin/cat\n',{mode:0o755});
    const plan=commandPlan({id:'r',query:{kind:'cli',location:'ssh',sshHost:'host'}},'meter-local-cli',[],'HOME');
    const stdout=await new Promise<string>((resolve,reject)=>{const child=execFile('/bin/sh',['-c',plan.args.at(-1)!],{env:{...process.env,HOME:home,PATH:'/usr/bin:/bin',SHELL:'/bin/false'}},(err,out)=>err?reject(err):resolve(out));child.stdin!.end('protocol input\n');});
    assert.equal(stdout,'found-local\nprotocol input\n');
  }finally{await rm(home,{recursive:true,force:true});}
});
