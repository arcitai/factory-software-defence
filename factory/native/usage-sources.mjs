import { readFileSync, realpathSync, lstatSync } from 'node:fs';
import { join, isAbsolute, resolve } from 'node:path';
import { AppServer } from './app-server.mjs';
import { ClaudeProcess, initializationGaps } from './claude.mjs';
import { claudeArgs } from './claude-setup.mjs';
import { readNative } from './setup.mjs';
import { atomicallyWrite, hash } from './writer.mjs';
import { codexUsage, claudeUsage, usageCache } from './usage.mjs';
import { readClaudeObservation } from './claude-usage-observation.mjs';
import { acquireProcessLock } from './process-lock.mjs';

const linksPath=state=>join(state,'usage-links.json');
const identity=native=>hash(`${native.config.harness||'codex'}:${native.config.harness==='claude'?native.config.config_dir:native.env.CODEX_HOME}`);
function readLinks(state) {
  let value;
  try {
    const info=lstatSync(linksPath(state));
    if(!info.isFile() || info.mode&0o077 || info.size>16000)throw Error('Invalid usage links.');
    value=JSON.parse(readFileSync(linksPath(state),'utf8'));
  } catch(error) {if(error.code==='ENOENT')return [];throw Error('Usage links are unreadable; inspect the private state.');}
  if(value.version!==1 || !Array.isArray(value.sources) || value.sources.length>4 || value.sources.some(source=>
    !isAbsolute(source?.state||'') || !['codex','claude'].includes(source.harness) || !/^[a-f0-9]{64}$/.test(source.profile||'')))throw Error('Invalid usage links.');
  return value.sources;
}

// Explicit local links grant quota reads only. They do not change the executor,
// copy credentials, discover personal profiles or attach another repository.
export function linkUsage(statePath,targetPath,remove=false,{load=readNative,lock=acquireProcessLock}={}) {
  const owner=load(statePath),release=lock(join(owner.state,'usage-links.lock'),'Usage link update');
  try {
  const links=readLinks(owner.state);
  let target;
  try{target=realpathSync(targetPath);}catch(error){if(!remove||error.code!=='ENOENT')throw error;target=resolve(targetPath);}
  if(remove) {
    atomicallyWrite(linksPath(owner.state),{version:1,sources:links.filter(source=>source.state!==target)});
    return {status:'unlinked'};
  }
  const native=load(target),profile=identity(native);
  if(profile===identity(owner)||links.some(source=>source.profile===profile))return {status:'already_linked'};
  if(links.length>=4)throw Error('At most four additional usage profiles can be linked.');
  atomicallyWrite(linksPath(owner.state),{version:1,sources:[...links,{state:native.state,harness:native.config.harness||'codex',profile}]});
  return {status:'linked',harness:native.config.harness||'codex'};
  }finally{release();}
}

export async function readNativeUsage(native) {
  const {config,state,env}=native;
  if(config.harness!=='claude') {
    const client=new AppServer({config,env});
    try {await client.connect();return codexUsage(await client.call('account/rateLimits/read'));}finally{client.close();}
  }
  const probe=new ClaudeProcess({command:config.claude,args:claudeArgs(config,state,{probe:true}),cwd:config.repo,env});
  try {
    probe.start();
    if(initializationGaps(await probe.request('initialize',{},20000)).length)throw Error('Native initialization unavailable.');
    const reply=(await probe.request('get_usage',{skip_behaviors:true},20000)).response;
    if(probe.malformed||probe.refused.length)throw Error('Native usage unavailable.');
    const result=claudeUsage(reply);
    if(result.windows.some(limit=>limit.used_percent!==null))return result;
    const observed=readClaudeObservation(config);
    return observed?{...observed,plan:result.plan,note:'Latest native work observation; the direct quota read returned no limits.'}:result;
  }finally{probe.end();probe.kill();}
}

export function createUsageReader(state,{load=readNative,read=readNativeUsage,now=Date.now}={}) {
  const caches=new Map();
  return async()=>{
    const owner=load(state),seen=new Set();
    const sources=[{state:owner.state,harness:owner.config.harness||'codex',profile:identity(owner)},...readLinks(owner.state)]
      .filter(source=>{if(seen.has(source.profile))return false;seen.add(source.profile);return true;});
    const active=new Set(sources.map(source=>source.profile));
    for(const key of caches.keys())if(!active.has(key))caches.delete(key);
    const profiles=await Promise.all(sources.map(async(source)=>{
      if(!caches.has(source.profile))caches.set(source.profile,usageCache({now,read:async()=>{
        const native=load(source.state);
        if(identity(native)!==source.profile)throw Error('Linked native profile changed.');
        return read(native);
      }}));
      return {id:source.profile.slice(0,16),harness:source.harness,...await caches.get(source.profile)()};
    }));
    return {profiles,scope:'account',refresh_after_seconds:120};
  };
}
