import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { closeSync, openSync, rmSync, writeSync } from 'node:fs';
import { setupNative, readNative } from './setup.mjs';
import { AppServer, nativeReadiness } from './app-server.mjs';
import { createNativeServer } from './server.mjs';

function parse(args) {
  const [action,...rest]=args,flags={};
  if(!['setup','login','doctor','serve'].includes(action))throw new Error('Use factory native setup|login|doctor|serve.');
  for(let i=0;i<rest.length;i++){
    const key=rest[i];if(!['--repo','--state','--codex','--port','--bundle-read'].includes(key)||!rest[i+1]||rest[i+1].startsWith('--')||Object.hasOwn(flags,key))throw new Error(`Invalid native option ${key}.`);
    flags[key]=rest[++i];
  }
  if(!flags['--state']||(action==='setup'&&!flags['--repo'])||(action!=='setup'&&(flags['--repo']||flags['--codex']||flags['--bundle-read']))||(action!=='serve'&&flags['--port']))throw new Error('Native setup needs --repo and --state; other commands need --state.');
  return {action,flags};
}
export async function runNative(args) {
  const {action,flags}=parse(args);
  if(action==='setup') {console.log(JSON.stringify(setupNative(flags['--repo'],flags['--state'],flags['--codex'],flags['--bundle-read']),null,2));return;}
  const {state,config,env}=readNative(flags['--state']);
  if(action==='login') {
    const code=await new Promise((done,reject)=>{const child=spawn(config.codex,['login'],{cwd:config.repo,env,stdio:'inherit'});child.once('error',reject);child.once('close',done);});
    if(code!==0)throw new Error('Native Codex login did not complete.');return;
  }
  const client=new AppServer({config,env});
  let lock=false;
  try {
    if(action==='serve') {
      const fd=openSync(join(state,'serve.lock'),'wx',0o600);
      try {writeSync(fd,`${process.pid}\n`);}finally{closeSync(fd);}lock=true;
    }
    try { await client.connect(); }
    catch(error) {
      if(action==='doctor') {console.log(JSON.stringify({mode:'native',repo:config.repo,state,readiness:{ready:false,gaps:[`Native app-server unavailable: ${error.message}`],account:'unknown',permissions:'unknown',connections:'unknown'},experimental:['Codex app-server','permission profiles'],live_qualification:'not established by doctor'},null,2));process.exitCode=1;return;}
      throw error;
    }
    if(action==='doctor') {
      const result=await nativeReadiness(client,config,state);
      console.log(JSON.stringify({mode:'native',repo:config.repo,state,readiness:result,experimental:['Codex app-server','permission profiles'],live_qualification:'not established by doctor'},null,2));
      if(!result.ready)process.exitCode=1;
      return;
    }
    const port=flags['--port']===undefined?7332:Number(flags['--port']);
    if(!Number.isSafeInteger(port)||port<1||port>65535)throw new Error('Choose a valid --port.');
    const {server}=createNativeServer(state,config,client);
    await new Promise((done,reject)=>server.once('error',reject).listen(port,'127.0.0.1',done));
    console.log(`Native Inbox: http://127.0.0.1:${port}`);
    await new Promise(resolve=>{const close=()=>server.close(resolve);process.once('SIGINT',close);process.once('SIGTERM',close);});
  } finally {client.close();if(lock)rmSync(join(state,'serve.lock'));}
}
