#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { probeCodex } from '../scripts/probe-harness.mjs';
import { setupNative, readNative } from '../factory/native/setup.mjs';
import { AppServer, nativeReadiness } from '../factory/native/app-server.mjs';
import { NativeEngine } from '../factory/native/engine.mjs';
import { connectBridge, registerBridge } from '../factory/native/bridge-client.mjs';
import { acquireProcessLock } from '../factory/native/process-lock.mjs';
import { manageNativeService, pendingServiceAdoptionToken } from '../factory/native/service.mjs';
import { issueProvider } from '../factory/issue-provider.mjs';
import { checkRelease } from '../factory/release-check.mjs';
import { validateDefinition, DefinitionError } from '../factory/definition.mjs';
import { exportKit } from '../scripts/export-kit.mjs';

const root=fileURLToPath(new URL('../',import.meta.url));
const packageIdentity=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
const version=packageIdentity.version;
const stateDefault=join(process.env.XDG_STATE_HOME || join(homedir(),'.local','state'),'software-defence-factory','native');
const usage=`Factory ${version} · native Codex and GitHub Inbox

Usage:
  factory setup --repo PATH [--state PATH] [--codex PATH] [--bundle-read PATH]
  factory login [--state PATH]
  factory doctor [--state PATH]
  factory serve [--state PATH] [--port PORT]
  factory issue URL [--state PATH]
  factory issues list|connection|templates|submissions [--state PATH]
  factory issues list [--page N] [--status open|closed|all] [--state PATH]
  factory issues draft|create --file JSON_FILE [--state PATH]
  factory issues recover REQUEST_ID [--state PATH]
  factory status [ID] [--state PATH]
  factory result ID [--state PATH]
  factory reconnect ID [--state PATH]
  factory start URL [--work-type software|defensive] [--brief TEXT] [--state PATH]
  factory continue ID --turn TURN_ID --feedback TEXT [--state PATH]
  factory interrupt ID --turn TURN_ID [--state PATH]
  factory service install|status|start|stop|restart|remove|cancel-maintenance [--state PATH] [--port PORT]
  factory service adopt --state PATH
  factory updates check --channel latest|next
  factory kit --output NEW_DIRECTORY
  factory definition validate --file FILE --repo PATH
  factory kit --definition FILE --repo PATH --output NEW_DIRECTORY
  factory foundation
  factory probe codex
  factory runtime [--state PATH]

GitHub owns issues, pull requests and CI. Codex owns sessions, execution,
permissions and history. Continue is explicit and always requires the current
terminal turn identity. Nothing is automatically replayed or published.
`;
function parse(args,{positionals=0,allowed=[]}={}) {
  const values=args.slice(0,positionals),flags={};
  if(values.length!==positionals||values.some(value=>value.startsWith('--')))throw new Error('Missing command argument.');
  for(let index=positionals;index<args.length;index++) {
    const key=args[index];
    if(!allowed.includes(key)||!args[index+1]||args[index+1].startsWith('--')||Object.hasOwn(flags,key))throw new Error(`Invalid or repeated option ${key}.`);
    flags[key]=args[++index];
  }
  return {values,flags};
}
const stateFrom=flags=>resolve(flags['--state'] || stateDefault);
function print(value) {process.stdout.write(`${JSON.stringify(value,null,2)}\n`);}
async function online(state,action) {const native=readNative(state);return action(await connectBridge(native.state,native.config.repo));}
function getJob(jobs,id) {
  const job=jobs.find(item=>item.id===id);
  if(!job)throw new Error('Native issue history not found.');
  return job;
}
function jobID(value) {if(!/^job_[a-f0-9]+$/.test(value||''))throw new Error('Choose a recorded native job ID.');return value;}
async function serve(state,port) {
  if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('Choose a loopback port from 1024 to 65535.');
  const {state:realState,config,env}=readNative(state),release=acquireProcessLock(join(realState,'serve.lock'),'Factory dashboard');
  const client=new AppServer({config,env});
  let unregister=()=>{},server;
  try {
    await client.connect();
    const {createNativeServer}=await import('../factory/native/server.mjs');
    const provider=issueProvider(config.repo),engine=new NativeEngine(realState,config,client,provider);
    Object.defineProperties(engine,{name:{value:'codex'},available:{get:()=>client.available}});
    const instance=randomUUID();
    ({server}=createNativeServer(realState,config,{harness:engine,provider,instance,maintenanceToken:pendingServiceAdoptionToken(realState)}));
    await new Promise((done,reject)=>server.once('error',reject).listen(port,'127.0.0.1',done));
    unregister=registerBridge(realState,config.repo,server.address().port,instance);
    console.log(`Factory Inbox: http://127.0.0.1:${port}`);
    await new Promise(resolveClose=>{
      let closing=false;
      const close=()=>{
        if(closing)return;closing=true;
        server.close(()=>resolveClose());server.closeIdleConnections?.();
      };
      process.once('SIGINT',close);process.once('SIGTERM',close);
    });
  } finally {
    if(server?.listening)await new Promise(resolve=>server.close(resolve));
    unregister();client.close();release();
  }
}
async function command(args) {
  if(args[0]==='native')args=args.slice(1); // 0.17 native-mode alias
  const [name,...rest]=args;
  if(!name||name==='help'||name==='--help'||name==='-h'){process.stdout.write(usage);return;}
  if(name==='--version'||name==='-v'){console.log(version);return;}
  if(name==='setup') {
    const {flags}=parse(rest,{allowed:['--repo','--state','--codex','--bundle-read']});
    if(!flags['--repo'])throw new Error('Setup needs --repo PATH.');
    print(setupNative(flags['--repo'],flags['--state'] || stateDefault,flags['--codex'],flags['--bundle-read']));return;
  }
  if(name==='login'||name==='doctor') {
    const {flags}=parse(rest,{allowed:['--state']}),state=stateFrom(flags),native=readNative(state);
    if(name==='login') {
      const code=await new Promise((done,reject)=>{const child=spawn(native.config.codex,['login'],{cwd:native.config.repo,env:native.env,stdio:'inherit'});child.once('error',reject);child.once('close',done);});
      if(code!==0)throw new Error('Native Codex login did not complete.');return;
    }
    const client=new AppServer({config:native.config,env:native.env});
    try {
      try {await client.connect();}
      catch(error){print({mode:'native',repo:native.config.repo,state,readiness:{ready:false,gaps:[`Native app-server unavailable: ${error.message}`],account:'unknown',permissions:'unknown',connections:'unknown'},live_qualification:'not established by doctor'});process.exitCode=1;return;}
      const readiness=await nativeReadiness(client,native.config,state);print({mode:'native',repo:native.config.repo,state,readiness,live_qualification:'not established by doctor'});
      if(!readiness.ready)process.exitCode=1;
    } finally {client.close();}
    return;
  }
  if(name==='serve') {
    const {flags}=parse(rest,{allowed:['--state','--port']});
    return serve(stateFrom(flags),Number(flags['--port'] || 7332));
  }
  if(name==='service') {
    const [action,...options]=rest;
    if(!action)throw new Error('Use service install|status|start|stop|restart|remove|cancel-maintenance|adopt.');
    const {flags}=parse(options,{allowed:action==='adopt'?['--state']:['--state','--port']});
    if(action==='adopt'&&!flags['--state'])throw new Error('Service adoption requires an explicit --state PATH.');
    const result=await manageNativeService(action,stateFrom(flags),Number(flags['--port'] || 7332));print(result);
    if(action==='adopt'&&!['adopted','no_op'].includes(result.status))process.exitCode=1;
    return;
  }
  if(name==='issues') {
    const [action,...options]=rest;
    const reads={list:'/api/v1/issues',connection:'/api/v1/issue-connection',templates:'/api/v1/issue-templates',submissions:'/api/v1/issue-submissions'};
    if(Object.hasOwn(reads,action || '')) {
      const {flags}=parse(options,{allowed:action==='list'?['--state','--page','--status']:['--state']});
      const query=action==='list'?`?${new URLSearchParams({page:flags['--page'] || '1',state:flags['--status'] || 'open'})}`:'';
      return online(stateFrom(flags),async bridge=>print(await bridge.request(reads[action]+query)));
    }
    if(action==='draft'||action==='create') {
      const {flags}=parse(options,{allowed:['--state','--file']});
      if(!flags['--file'])throw new Error(`${action} requires --file JSON_FILE using the shared issue API fields.`);
      const text=readFileSync(flags['--file'],'utf8');
      if(Buffer.byteLength(text)>256000)throw new Error('Issue input exceeds 256 KB.');
      const input=JSON.parse(text);
      if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('Issue input must be a JSON object.');
      return online(stateFrom(flags),async bridge=>print(await bridge.request(action==='draft'?'/api/v1/issue-templates/draft':'/api/v1/issues',input)));
    }
    if(action==='recover') {
      const {values,flags}=parse(options,{positionals:1,allowed:['--state']});
      if(!/^[A-Za-z0-9_-]{16,100}$/.test(values[0]))throw new Error('Choose the recorded issue creation request ID.');
      return online(stateFrom(flags),async bridge=>print(await bridge.request(`/api/v1/issue-submissions/${values[0]}/recover`,{})));
    }
    throw new Error('Use issues list|connection|templates|draft|create|submissions|recover.');
  }
  if(name==='issue'||name==='start') {
    const {values,flags}=parse(rest,{positionals:1,allowed:name==='start'?['--state','--work-type','--brief']:['--state']});
    const state=stateFrom(flags);
    return online(state,async bridge=>{
      const issue=await bridge.request('/api/v1/issues/preview',{url:values[0]});
      if(name==='issue'){print(issue);return;}
      const created=await bridge.request('/api/v1/issues/start',{url:issue.url,expected_spec:issue.spec,brief:flags['--brief'] || '',work_type:flags['--work-type'] || issue.recommendation?.workflow || 'software'});
      print(created);
    });
  }
  if(name==='status'||name==='result') {
    const positional=name==='result'?1:rest[0]&&!rest[0].startsWith('--')?1:0;
    const {values,flags}=parse(rest,{positionals:positional,allowed:['--state']});
    return online(stateFrom(flags),async bridge=>{
      if(name==='status') {
        const jobs=(await bridge.request('/api/v1/status')).jobs;
        print(values.length?getJob(jobs,jobID(values[0])):jobs);
      } else {
        const job=await bridge.request(`/api/v1/jobs/${jobID(values[0])}/result`);
        print({id:job.id,thread_id:job.thread_id,turn_id:job.turn_id,state:job.state,native_turns:job.native_turns,native_result:job.native_result});
      }
    });
  }
  if(name==='continue'||name==='interrupt') {
    const {values,flags}=parse(rest,{positionals:1,allowed:name==='continue'?['--state','--turn','--feedback']:['--state','--turn']});
    if(!flags['--turn'])throw new Error(`${name} needs --turn TURN_ID.`);
    if(name==='continue'&&!flags['--feedback'])throw new Error('Continue needs --feedback TEXT.');
    return online(stateFrom(flags),async bridge=>print(await bridge.request(`/api/v1/jobs/${jobID(values[0])}/${name}`,
      name==='continue'?{expected_turn_id:flags['--turn'],feedback:flags['--feedback']}:{turn_id:flags['--turn']})));
  }
  if(name==='reconnect') {
    const {values,flags}=parse(rest,{positionals:1,allowed:['--state']});
    return online(stateFrom(flags),async bridge=>print(await bridge.request(`/api/v1/jobs/${jobID(values[0])}/resume`,{})));
  }
  if(name==='updates') {
    if(rest[0]!=='check')throw new Error('Use updates check --channel latest|next; release activation remains manual.');
    const {flags}=parse(rest.slice(1),{allowed:['--channel']});
    print(await checkRelease({version,channel:flags['--channel']}));return;
  }
  if(name==='runtime') {
    const {flags}=parse(rest,{allowed:['--state']});
    const result={package:packageIdentity.name,version,entrypoint:root,source_checkout:existsSync(join(root,'.git')),native_state:'unknown'};
    if(existsSync(join(stateFrom(flags),'native.json'))) {
      const native=readNative(stateFrom(flags));result.native_state='configured';result.repository=native.config.repo;result.node=native.config.node;result.codex=native.config.codex;
    }
    print(result);return;
  }
  if(name==='probe') {
    if(rest.length!==1||rest[0]!=='codex')throw new Error('Use probe codex; authentication and project readiness remain separate.');
    print(await probeCodex());return;
  }
  if(name==='foundation') {
    const path=join(root,'.agents','skills','factory-foundation','SKILL.md');
    process.stdout.write(readFileSync(path,'utf8'));return;
  }
  if(name==='definition') {
    if(rest[0]!=='validate')throw new Error('Use definition validate --file FILE --repo PATH.');
    const {flags}=parse(rest.slice(1),{allowed:['--file','--repo']});
    if(!flags['--file']||!flags['--repo'])throw new Error('Definition validation requires explicit --file and --repo.');
    print(validateDefinition({file:flags['--file'],repo:flags['--repo']}));return;
  }
  if(name==='kit') {
    const {flags}=parse(rest,{allowed:['--output','--definition','--repo']});
    if(!flags['--output'])throw new Error('Use kit --output NEW_DIRECTORY.');
    if(Boolean(flags['--definition'])!==Boolean(flags['--repo']))throw new Error('Definition kit requires both --definition FILE and --repo PATH.');
    const definition=flags['--definition']?validateDefinition({file:flags['--definition'],repo:flags['--repo']}):undefined;
    const result=await exportKit({output:flags['--output'],definition});
    if(definition)print(result);
    else console.log(`Exported ${result.files} files to ${result.destination}. Review .factory-kit/README.md before adoption. No app or service was configured.`);
    return;
  }
  throw new Error(name==='claude'||name==='pi'||name==='cursor'||name==='grok'
    ? `Harness '${name}' is not available in this release; Codex is the selected native integration.`
    : `Unknown command '${name}'. Use factory help.`);
}

try {await command(process.argv.slice(2));}
catch(error) {
  if(error instanceof DefinitionError)print(error.result);
  else if(process.argv[2]==='definition'||(process.argv[2]==='kit'&&process.argv.includes('--definition'))) {
    const option=process.argv[2]==='definition'?'--file':'--definition';
    const index=process.argv.indexOf(option);
    print(new DefinitionError(error.code==='EEXIST'?'DESTINATION_EXISTS':'DEFINITION_COMMAND',error.message,index>=0?(process.argv[index+1] || '<command>'):'<command>').result);
  }
  console.error(`Factory: ${error.message}`);process.exitCode=1;
}
