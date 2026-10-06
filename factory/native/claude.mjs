import { execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { associateIssue, canonicalIssue } from '../issue-lifecycle.mjs';
import { FactoryError } from '../error.mjs';
import { recordClaudeObservation } from './claude-usage-observation.mjs';
import { CLAUDE_BUILTIN_PLUGINS, CLAUDE_BUILTIN_SKILLS, CLAUDE_INIT_BUILTIN_SKILLS, CLAUDE_TOOLS, FACTORY_SKILLS, FACTORY_SKILL_SOURCE,
  claudeArgs, claudeAuthArgs, claudeEnvironment, claudeInventoryArgs, claudeSettings, verifyClaudeConfig } from './claude-setup.mjs';
import { atomicallyWrite, boundedText, discardUnsentReceipt, hash, issuePrompt, readReceipts, readWriter, restoreUnsentWriter, saveReceipt, validStartInput, withWriterGate, writerPath } from './writer.mjs';

const MAX_FRAME = 16 * 1024 * 1024;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const empty = value => value===undefined || value===null || value===false || value==='' || (Array.isArray(value) && !value.length) || (plain(value) && !Object.keys(value).length);
const sameSet = (left,right) => Array.isArray(left) && Array.isArray(right) && left.length===right.length && JSON.stringify([...left].sort())===JSON.stringify([...right].sort());
const terminal = new Set(['needs_review','failed','interrupted']);
const RESULT_SUBTYPES = ['success','error_during_execution','error_max_turns','error_max_budget_usd','error_max_structured_output_retries'];
const historyScript = fileURLToPath(new URL('./claude-history.mjs', import.meta.url));
const bounded = value => typeof value==='string' ? value.slice(0,128) : null;

// One native `claude -p` stream-json process. Control replies resolve with their
// full envelope; every request the CLI sends to Factory is refused and retained.
export class ClaudeProcess {
  constructor({ command, args, cwd, env, spawnImpl = spawn }) {
    Object.assign(this,{command,args,cwd,env,spawnImpl});
    this.pending=new Map();this.listeners=new Set();this.buffer=Buffer.alloc(0);this.discarding=false;
    this.malformed=false;this.exited=null;this.refused=[];
  }
  start() {
    this.child=this.spawnImpl(this.command,this.args,{cwd:this.cwd,env:this.env,stdio:['pipe','pipe','pipe']});
    this.child.stderr.on('data',()=>{});
    this.child.stdin.on('error',()=>{});
    this.child.once('error',()=>this.finish(null));
    this.child.once('close',code=>this.finish(code));
    this.child.stdout.on('data',chunk=>this.read(chunk));
    return this;
  }
  finish(code) {
    if (this.exited) return;
    // An incomplete trailing frame means the native output cannot be trusted.
    if (this.buffer.length || this.discarding) this.malformed=true;
    this.exited={code};
    for (const {reject,timer} of this.pending.values()) {clearTimeout(timer);reject(new Error('Native Claude process ended.'));}
    this.pending.clear();
    this.emit({type:'factory/exit',code});
  }
  read(chunk) {
    let offset=0;
    while (offset<chunk.length) {
      const end=chunk.indexOf(10,offset);
      if (this.discarding) { if (end<0) return; this.discarding=false;offset=end+1;continue; }
      const part=chunk.subarray(offset,end<0?chunk.length:end);
      if (this.buffer.length+part.length>MAX_FRAME) {
        this.buffer=Buffer.alloc(0);this.malformed=true;
        if (end<0) {this.discarding=true;return;}
        offset=end+1;continue;
      }
      this.buffer=Buffer.concat([this.buffer,part]);
      if (end<0) return;
      const line=this.buffer.toString('utf8');this.buffer=Buffer.alloc(0);offset=end+1;
      if (line.trim()) this.receive(line);
    }
  }
  receive(line) {
    let value;
    try {value=JSON.parse(line);} catch {this.malformed=true;return;}
    if (!plain(value)) {this.malformed=true;return;}
    if (value.type==='control_response') {
      const reply=value.response,pending=this.pending.get(reply?.request_id);
      if (!pending) return;
      clearTimeout(pending.timer);this.pending.delete(reply.request_id);
      return reply.subtype==='success' ? pending.resolve(reply) : pending.reject(new Error('Native control request failed.'));
    }
    if (value.type==='control_request') {
      const id=value.request_id,subtype=value.request?.subtype;
      this.refused=[...this.refused,{request_id:bounded(id),subtype:bounded(subtype)}].slice(-20);
      try {
        this.send(subtype==='can_use_tool'
          ? {type:'control_response',response:{subtype:'success',request_id:id,response:{behavior:'deny',message:'Factory refuses interactive authority requests.',interrupt:true}}}
          : {type:'control_response',response:{subtype:'error',request_id:id,error:'Refused by Factory.'}});
      } catch { /* The exit handler resolves the run as unknown. */ }
      return this.emit({type:'factory/unexpected',request_id:bounded(id),subtype:bounded(subtype)});
    }
    this.emit(value);
  }
  emit(value) {for (const listener of this.listeners) listener(value);}
  on(listener) {this.listeners.add(listener);}
  send(value) {
    if (!this.child?.stdin?.writable || this.exited) throw Object.assign(new Error('Native Claude process unavailable.'),{notSent:true});
    const frame=`${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(frame)>MAX_FRAME) throw Object.assign(new Error('Native frame too large.'),{notSent:true});
    this.child.stdin.write(frame);
  }
  request(subtype,extra={},timeout=15000) {
    const request_id=`factory-${randomBytes(8).toString('hex')}`;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(request_id);reject(new Error(`Native ${subtype} timed out.`));},timeout);
      this.pending.set(request_id,{resolve,reject,timer});
      try {this.send({type:'control_request',request_id,request:{subtype,...extra}});}
      catch(error) {clearTimeout(timer);this.pending.delete(request_id);reject(error);}
    });
  }
  end() {try {this.child?.stdin?.end();} catch {}}
  kill() {
    const child=this.child;
    if (!child || this.exited) return;
    child.kill('SIGTERM');
    setTimeout(()=>{if (child.exitCode===null) child.kill('SIGKILL');},2000).unref();
  }
}

// Pending permission and dialog lists are siblings of `response` in the
// initialize envelope. A held (requires_action) session is never resumed.
export function initializationGaps(reply) {
  const gaps=[];
  if (!plain(reply?.response)) gaps.push('Native initialization unavailable');
  if (!Array.isArray(reply?.pending_permission_requests) || reply.pending_permission_requests.length
    || !Array.isArray(reply?.pending_user_dialog_requests) || reply.pending_user_dialog_requests.length
    || [reply?.session_state,reply?.response?.session_state].includes('requires_action'))
    gaps.push('Native pending permission or dialog state unavailable or nonempty');
  return gaps;
}
// Pinned keys match exactly; anything native adds inside a pinned object must be empty or false.
function matches(pinned,actual) {
  if (Array.isArray(pinned)) return sameSet(pinned,actual);
  if (plain(pinned)) return plain(actual) && Object.keys(pinned).every(key=>matches(pinned[key],actual[key]))
    && Object.keys(actual).every(key=>Object.hasOwn(pinned,key) || empty(actual[key]));
  return pinned===actual;
}
const forbiddenSettings = ['hooks','mcpServers','enableAllProjectMcpServers','enabledMcpjsonServers','apiKeyHelper','env',
  'extraKnownMarketplaces','statusLine','otelHeadersHelper','awsAuthRefresh','awsCredentialExport','additionalDirectories'];
export function settingsMatch(pinned,effective) {
  return plain(effective) && Object.keys(pinned).every(key=>matches(pinned[key],effective[key]))
    && forbiddenSettings.every(key=>empty(effective[key]));
}
// Context summary skills carry a source; Factory skills must come from the profile.
export function contextSkillsMatch(entries) {
  if (!Array.isArray(entries) || entries.some(entry=>!plain(entry))) return false;
  if (new Set(entries.map(entry=>entry.name)).size!==entries.length) return false;
  return FACTORY_SKILLS.every(name=>entries.some(entry=>entry.name===name))
    && entries.every(entry=>(FACTORY_SKILLS.includes(entry.name) && entry.source===FACTORY_SKILL_SOURCE)
      || CLAUDE_BUILTIN_SKILLS.some(known=>known.name===entry.name && known.source===entry.source));
}
// The live system/init inventory must match before Factory recognizes a run.
export function startupMatches(message,config,session) {
  const skills=message.skills,plugins=message.plugins;
  return message.cwd===config.repo && message.model===config.model && message.session_id===session
    && message.permissionMode==='dontAsk' && (message.effort===undefined || message.effort===config.effort)
    && sameSet(message.tools,CLAUDE_TOOLS) && Array.isArray(message.mcp_servers) && !message.mcp_servers.length
    && Array.isArray(plugins) && plugins.every(plugin=>plain(plugin) && CLAUDE_BUILTIN_PLUGINS.some(known=>known.name===plugin.name
      && known.path===plugin.path && (plugin.source===undefined || plugin.source===known.source)))
    && Array.isArray(skills) && new Set(skills).size===skills.length && FACTORY_SKILLS.every(name=>skills.includes(name))
    && skills.every(name=>FACTORY_SKILLS.includes(name) || CLAUDE_INIT_BUILTIN_SKILLS.includes(name));
}
export function validResult(message) {
  return RESULT_SUBTYPES.includes(message.subtype) && typeof message.is_error==='boolean' && typeof message.session_id==='string'
    && typeof message.uuid==='string' && (message.subtype==='success' ? !message.is_error && typeof message.result==='string'
      : message.is_error && Array.isArray(message.errors) && message.errors.every(error=>typeof error==='string'));
}

function runJson(command,args,{cwd,env,maxBuffer=1024*1024}) {
  return new Promise((resolve,reject)=>execFile(command,args,{cwd,env,timeout:15000,maxBuffer},
    (error,stdout)=>{if (error) return reject(error);try {resolve(JSON.parse(stdout));} catch(parse) {reject(parse);}}));
}
// Native auth status is the login authority; only non-identifying fields are kept.
async function claudeAuthStatus(config,env) {
  const status=await runJson(config.claude,claudeAuthArgs,{cwd:config.repo,env,maxBuffer:64*1024});
  return {loggedIn:status?.loggedIn,authMethod:status?.authMethod,subscriptionType:status?.subscriptionType};
}
const nativeVersion=(config,env)=>new Promise((resolve,reject)=>execFile(config.claude,['--version'],
  {cwd:config.repo,env,timeout:15000,maxBuffer:64000},(error,stdout)=>error?reject(error):resolve(stdout.trim())));

export async function claudeReadiness(config,state,{spawnImpl=spawn,version=nativeVersion,auth=claudeAuthStatus}={}) {
  const gaps=[],env=claudeEnvironment(config,state),result={account:'unknown',permissions:'unknown',connections:'unknown',
    harness:'claude',version:'unknown',model:config.model,effort:config.effort,usage:'unknown',
    tools:'pinned by --tools; live tool inventory is confirmed when each native run starts'};
  // Nothing executes until the pinned settings, skills and executable bytes match.
  try {verifyClaudeConfig(state,config);} catch(error) {return {ready:false,gaps:[error.message],...result};}
  try {result.version=await version(config,env);if (result.version!==config.claude_version) gaps.push('Pinned Claude version changed');}
  catch {gaps.push('Claude executable unavailable');}
  const status=await auth(config,env).catch(()=>null);
  if (status?.loggedIn!==true) gaps.push('Native login required or auth status unavailable');
  else result.account=[status.authMethod,status.subscriptionType].filter(value=>typeof value==='string').join(' · ') || 'logged in';
  if (status?.loggedIn===true && status.authMethod!=='claude.ai') gaps.push('Claude subscription login required; API billing is not selected.');
  // A probe process never receives a prompt and does not persist a session.
  const probe=new ClaudeProcess({command:config.claude,args:claudeArgs(config,state,{probe:true}),cwd:config.repo,env,spawnImpl});
  try {
    probe.start();
    gaps.push(...initializationGaps(await probe.request('initialize',{},20000)));
    const settings=(await probe.request('get_settings')).response;
    if (settings?.applied?.model!==config.model || settings?.applied?.effort!==config.effort) gaps.push('Selected model or effort is not applied');
    if (!settingsMatch(claudeSettings(config,state),settings?.effective)) gaps.push('Effective Claude settings differ from the pinned Factory profile');
    else result.permissions='pinned settings verified';
    const hooks=(await probe.request('get_hooks_listing')).response;
    if (!Array.isArray(hooks?.hooks) || hooks.hooks.length || hooks.policy?.allDisabled!==true || hooks.policy?.policyHookCount!==0)
      gaps.push('Native hooks are not all disabled or policy hooks are present');
    const context=(await probe.request('get_context_usage',{detail:'summary'})).response;
    const listedTools=[...(context?.systemTools||[]),...(context?.deferredBuiltinTools||[])].map(tool=>tool?.name);
    if (!Array.isArray(context?.mcpTools) || context.mcpTools.length) gaps.push('MCP tool inventory unavailable or nonempty');
    else result.connections='none';
    // The summary omits tool lists on the pinned CLI; any tools it does list must still be allowlisted.
    if (listedTools.some(name=>!CLAUDE_TOOLS.includes(name))) gaps.push('Native tool inventory outside the allowlist');
    if (!contextSkillsMatch(context?.skills?.skillFrontmatter)) gaps.push('Native skill inventory unavailable or outside the allowlist');
  } catch {gaps.push('Native Claude control probe unavailable');}
  finally {probe.end();probe.kill();}
  if (probe.refused.length) gaps.push('Unexpected native authority request was refused');
  if (probe.malformed) gaps.push('Native control output was malformed');
  return {ready:gaps.length===0,gaps:[...new Set(gaps)],...result};
}

function runHistory(config,state,session,input) {
  return readHistory(config,state,{session,input});
}
function runHistories(config,state,records) {
  return readHistory(config,state,{sessions:records.map(record=>({session:record.session_id,input:record.turn_id}))});
}
function readHistory(config,state,query) {
  const env=claudeEnvironment(config,state);
  return runJson(config.node,[historyScript,JSON.stringify({...query,dir:config.repo})],
    {cwd:config.repo,env:{CLAUDE_CONFIG_DIR:env.CLAUDE_CONFIG_DIR,HOME:env.HOME,TMPDIR:env.TMPDIR,PATH:env.PATH,LANG:env.LANG}});
}
function runInventory(config,state) {
  verifyClaudeConfig(state,config,{reuseExecutable:true});
  return runJson(config.claude,claudeInventoryArgs(config),{cwd:config.repo,env:claudeEnvironment(config,state),maxBuffer:4*1024*1024});
}

export class ClaudeEngine {
  constructor(state,config,provider,{spawnImpl=spawn,history=runHistory,inventory=runInventory,readiness=claudeReadiness,confirmTimeout=30000}={}) {
    Object.assign(this,{state,config,provider,spawnImpl,historyImpl:history,inventoryImpl:inventory,readinessImpl:readiness,confirmTimeout});
    this.name='claude';this.available=true;this.runs=new Map();this.faults=new Set();this.readiness=null;
    this.historiesImpl=history===runHistory?runHistories:null;
  }
  async doctor() {
    if(this.checkingReadiness)return this.checkingReadiness;
    this.checkingReadiness=this.readinessImpl(this.config,this.state,{spawnImpl:this.spawnImpl});
    let ready;
    try {ready=await this.checkingReadiness;} finally {this.checkingReadiness=null;}
    // Faults observed by this bridge keep it unready until an operator inspects them.
    if (this.faults.size) {ready.gaps.push(...this.faults);ready.ready=false;}
    return this.readiness={...ready,checked_at:new Date().toISOString()};
  }
  async statusReadiness() {
    if(!this.readiness)await this.doctor();
    return {...this.readiness,ready:this.readiness.ready&&!this.faults.size,gaps:[...new Set([...this.readiness.gaps,...this.faults])]};
  }
  stateOf(record) {
    if (record.ambiguous) return 'unknown';
    if (this.runs.has(record.id)) return 'running';
    const result=record.result;
    if (record.phase!=='started' || !record.exited_at || !result || record.ambiguous || result.turn_id!==record.turn_id) return 'unknown';
    if (record.interrupt?.turn_id===record.turn_id && record.interrupt.confirmed_at) return 'interrupted';
    return result.subtype==='success' && !result.is_error ? 'needs_review' : 'failed';
  }
  makeJob(record,{state=this.stateOf(record),note=null}={}) {
    const result=record.result?.turn_id===record.turn_id && state!=='unknown'?record.result:null;
    const runs=(record.attempts||[]).filter(item=>item.turn_id).slice().reverse()
      .map(item=>({id:item.turn_id,command:'claude',state:item.turn_id===record.turn_id?state:(item.state||'unknown'),started_at:item.started_at||null,completed_at:item.completed_at||null}));
    return {id:record.id,native:true,harness:'claude',thread_id:record.session_id||null,turn_id:record.turn_id||null,
      created_at:record.created_at,updated_at:record.updated_at||record.created_at,state,
      task:{title:record.title,spec:`Issue content pinned by SHA-256: ${record.spec_hash}`,source_url:record.url},
      workflow:{name:record.work_type||'software',steps:[],current_step:0},runs,
      native_turn_status:record.turn_id?state:null,
      native_turns:runs.map(({id,state:runState,started_at,completed_at})=>({id,state:runState,started_at,completed_at})),
      native_result:result?{completed_at:result.completed_at,response:result.response,bounded:true,usage:result.usage,
        cost_note:'Native cost fields are API-equivalent estimates, not subscription usage or a charge.'}:null,
      native_refused_requests:record.refused_requests||[],
      native_state_note:note||record.ambiguous||record.note||null};
  }
  record(id) {return readReceipts(this.state).find(item=>item.id===id);}
  // Live native sessions for this repository; null when inventory is unavailable or malformed.
  async liveSessions() {
    const listed=await this.inventoryImpl(this.config,this.state).catch(()=>null);
    return Array.isArray(listed) && listed.every(entry=>plain(entry)) ? listed : null;
  }
  async historySnapshot(record,snapshot) {
    const history=snapshot===undefined?await this.historyImpl(this.config,this.state,record.session_id,record.turn_id).catch(()=>null):snapshot;
    return history?.session?.id===record.session_id && history.session.cwd===this.config.repo
      && history.input?.uuid===record.turn_id && history.input.session_id===record.session_id
      && typeof history.tip_uuid==='string' && history.tip_uuid ? history : null;
  }
  // A new native message after finalization invalidates the saved terminal view.
  async historyConfirms(record,snapshot) {
    const history=await this.historySnapshot(record,snapshot);
    return Boolean(record.history_tip && history?.tip_uuid===record.history_tip);
  }
  // A terminal receipt counts only while native history agrees and no live process holds its session.
  async reconciled(record,live,snapshot) {
    return terminal.has(this.stateOf(record)) && Array.isArray(live)
      && !live.some(entry=>entry.sessionId===record.session_id) && await this.historyConfirms(record,snapshot);
  }
  async projected(record,live,snapshot) {
    const job=this.makeJob(record);
    if (!terminal.has(job.state) || await this.reconciled(record,live,snapshot)) return job;
    return this.makeJob(record,{state:'unknown',note:'Native Claude history or live inventory does not confirm this result.'});
  }
  async jobs() {
    const records=readReceipts(this.state),result=[],completed=records.filter(record=>terminal.has(this.stateOf(record)));
    const [live,snapshots]=completed.length?await Promise.all([this.liveSessions(),this.historiesImpl
      ?this.historiesImpl(this.config,this.state,completed).catch(()=>null):Promise.resolve(undefined)]):[];
    for (const record of records) {
      const index=completed.indexOf(record),snapshot=snapshots===undefined?undefined:snapshots?.[index]||null;
      result.push(await this.projected(record,live,snapshot));
    }
    return result;
  }
  async result(id) {
    const record=this.record(id);
    if (!record) throw new FactoryError('Native issue history not found.',404);
    return this.projected(record,terminal.has(this.stateOf(record)) ? await this.liveSessions() : null);
  }
  async assertWorkspaceIdle() {
    if (this.runs.size) throw new FactoryError('A native Claude process owned by this bridge is still running.',409);
    const live=await this.liveSessions();
    if (!live) throw new FactoryError('Claude session inventory is unavailable; workspace ownership is unknown.',409);
    if (live.length) throw new FactoryError('Another native Claude session is active or unresolved in this workspace.',409);
    const owner=readWriter(this.config);
    if (owner) {
      if (owner.state!==this.state) throw new FactoryError('Another native installation owns the repository; workspace ownership is unresolved.',409);
      const record=this.record(owner.job_id);
      if (!record || !await this.reconciled(record,live))
        throw new FactoryError('Native writer receipt is active or unresolved; preserve it and inspect Claude history.',409);
    }
  }
  async replaceWriter(record) {
    await this.assertWorkspaceIdle();
    atomicallyWrite(writerPath(this.config),{job_id:record.id,state:this.state,repo:this.config.repo,harness:'claude',updated_at:new Date().toISOString()});
  }
  async issue(input) {return associateIssue(await this.provider.preview(input.url),await this.jobs());}
  async ensureReady(action) {
    const ready=await this.doctor();
    if (!ready.ready) throw new FactoryError(`Native readiness failed: ${ready.gaps.join('; ')}`,503);
    try {verifyClaudeConfig(this.state,this.config);} catch {throw new FactoryError(`Native permissions configuration changed; ${action} refused.`,503);}
  }
  async start(input) {
    const workType=validStartInput(input);
    await this.ensureReady('admission');
    const issue=await this.issue(input);
    if (issue.spec!==input.expected_spec) throw new FactoryError('Issue content changed. Refresh before starting.',409);
    if (issue.start_block_reason) throw new FactoryError(issue.start_block_reason,409);
    const identity=canonicalIssue(issue.url);
    if (!identity) throw new FactoryError('Unsupported issue identity.',400);
    const record={id:`job_${randomBytes(12).toString('hex')}`,key:identity.key,url:identity.url,title:issue.title,harness:'claude',
      work_type:workType,spec_hash:hash(issue.spec),created_at:new Date().toISOString(),phase:'reserved',session_id:randomUUID(),turn_id:null,attempts:[]};
    return withWriterGate(this.config,async()=>{
      if (readReceipts(this.state).some(item=>item.key===identity.key))
        throw new FactoryError('Issue already has native history or unresolved admission. Continue its recorded session.',409);
      const final=await this.doctor();
      if (!final.ready) throw new FactoryError('Native effective permissions changed during admission; no work was reserved.',503);
      const previousWriter=readWriter(this.config);
      await this.replaceWriter(record);
      try {saveReceipt(this.state,record,true);}
      catch(error) {if (error.code==='EEXIST') throw new FactoryError('Issue already has native history or unresolved admission.',409);throw error;}
      // The writer and admission receipts are durable before the native process starts.
      try {return await this.launch(record,issuePrompt({url:identity.url,specHash:record.spec_hash,spec:issue.spec,brief:input.brief,workType}),false);}
      catch(error) {
        if(error.notSent) {restoreUnsentWriter(this.config,this.state,record,previousWriter);discardUnsentReceipt(this.state,record);}
        throw error;
      }
    });
  }
  async continue(id,expectedTurnId,feedback) {
    if (!this.record(id)) throw new FactoryError('Native issue history not found.',404);
    if (typeof expectedTurnId!=='string' || !expectedTurnId || typeof feedback!=='string' || !feedback.trim() || feedback.length>16000)
      throw new FactoryError('Continue requires the expected terminal turn ID and operator feedback of at most 16,000 characters.',400);
    await this.ensureReady('continuation');
    return withWriterGate(this.config,async()=>{
      const fresh=this.record(id);
      if (!fresh?.session_id || fresh.phase!=='started' || fresh.turn_id!==expectedTurnId)
        throw new FactoryError('Expected terminal turn changed. Refresh status before continuing.',409);
      if (!await this.reconciled(fresh,await this.liveSessions()))
        throw new FactoryError('Expected turn is active, stale or ambiguous. Inspect native history before continuing.',409);
      await this.replaceWriter(fresh);
      return this.launch(fresh,feedback.trim(),true);
    });
  }
  // Persist before the prompt, then require a verified native startup and
  // confirmation of exactly one input.
  async launch(record,text,resume) {
    const config=this.config,previous=structuredClone(record);
    try {verifyClaudeConfig(this.state,config);}
    catch {throw Object.assign(new FactoryError('Pinned Claude configuration or executable changed; no native process was started.',503),{notSent:true});}
    const input=randomUUID();
    record.phase='sending';record.pending_input_uuid=input;record.ambiguous=null;record.result=null;record.exited_at=null;record.interrupt=null;record.history_tip=null;
    record.expected_turn_id=resume?record.turn_id:null;record.updated_at=new Date().toISOString();
    record.attempts=[...(record.attempts||[]),{expected_turn_id:record.expected_turn_id,reserved_at:record.updated_at,phase:'reserved'}];
    saveReceipt(this.state,record);
    const proc=new ClaudeProcess({command:config.claude,args:claudeArgs(config,this.state,resume?{resume:record.session_id}:{session:record.session_id}),
      cwd:config.repo,env:claudeEnvironment(config,this.state),spawnImpl:this.spawnImpl});
    // While a run is live its in-memory receipt is the only receipt writer.
    const run={proc,record,turn:null,result:false,startup:false};
    const save=()=>{record.updated_at=new Date().toISOString();saveReceipt(this.state,record);};
    let confirm,finished;
    const finalized=new Promise(resolve=>{finished=resolve;});
    const confirmed=new Promise((resolve,reject)=>{confirm={resolve,reject};});
    confirmed.catch(()=>{}); // Early failures are reported by the awaiting caller or not at all.
    const doubt=(reason,status=503)=>{
      if (!record.ambiguous) {record.ambiguous=reason;save();}
      this.faults.add(`Native run unresolved: ${reason}`);
      if (!run.turn) confirm.reject(new FactoryError(`${reason} The run was refused and remains unresolved.`,status));
      if (!proc.exited && !run.stopping) {
        run.stopping=true;
        proc.request('interrupt',{cancel_queued:true}).catch(()=>{}).finally(()=>proc.end());
        setTimeout(()=>proc.kill(),2000).unref();
      }
    };
    proc.on(message=>{
      if(message.type==='rate_limit_event') {recordClaudeObservation(config,message);return;}
      if (message.type==='factory/unexpected') {
        record.refused_requests=[...(record.refused_requests||[]),{request_id:message.request_id,subtype:message.subtype}].slice(-20);
        return doubt('An unexpected native authority request was refused.',409);
      }
      if (message.type==='factory/exit') {
        const finish=async()=>{
        if (proc.malformed && !record.ambiguous) {record.ambiguous='Native output was malformed, incomplete or exceeded the frame limit.';this.faults.add(`Native run unresolved: ${record.ambiguous}`);}
        record.exited_at=new Date().toISOString();record.exit_code=message.code;
        if (record.result?.subtype==='success' && message.code!==0)
          record.ambiguous||='Native process did not exit successfully after its result.';
        if (run.startup && record.result && !record.ambiguous) {
          const history=await this.historySnapshot(record);
          if (history) record.history_tip=history.tip_uuid;
          else record.ambiguous='Native history did not confirm the input after process exit.';
        }
        this.runs.delete(record.id);
        const attempt=record.attempts.at(-1);
        if (run.turn && attempt?.turn_id===run.turn) {attempt.completed_at=record.result?.completed_at||null;attempt.state=this.stateOf(record);}
        save();confirm.reject(new FactoryError('Native Claude process ended before confirming the input; outcome unknown. No retry was attempted.',503));
        };
        finish().catch(()=>{this.runs.delete(record.id);this.faults.add('Native completion could not be saved; inspect native history.');confirm.reject(new FactoryError('Native completion is unresolved.',503));}).finally(finished);
        return;
      }
      if (message.type==='system' && message.subtype==='init') {
        if (startupMatches(message,config,record.session_id)) run.startup=true;
        else {run.startup=false;doubt('Native startup identity or tool inventory did not match the pinned profile.');}
        return;
      }
      if (message.type==='system' && message.subtype==='session_state_changed' && message.state==='requires_action')
        return doubt('Native session requires an action Factory does not grant.',409);
      if (message.type==='user' && !run.turn && message.session_id===record.session_id && message.uuid===input) {
        run.turn=message.uuid;record.turn_id=message.uuid;record.phase='started';delete record.pending_input_uuid;delete record.expected_turn_id;
        record.attempts[record.attempts.length-1]={turn_id:run.turn,expected_turn_id:record.attempts.at(-1).expected_turn_id,started_at:new Date().toISOString()};
        save();
        if (!run.startup) {
          return doubt('Native input arrived before a verified startup inventory.');
        }
        if (record.ambiguous) return confirm.reject(new FactoryError(`${record.ambiguous} The run remains unresolved.`,409));
        return confirm.resolve();
      }
      if (message.type==='result') {
        if (run.result) return doubt('Duplicate native completion received.');
        run.result=true;
        const uuids=[message.user_message_uuid,...(Array.isArray(message.user_message_uuids)?message.user_message_uuids:[])];
        if (!validResult(message)) return doubt('Native completion had an unexpected shape.');
        if (!run.turn || message.session_id!==record.session_id || !uuids.includes(run.turn)) return doubt('Native completion did not match the confirmed input.');
        record.result={turn_id:run.turn,subtype:message.subtype,is_error:message.is_error,stop_reason:message.stop_reason??null,
          terminal_reason:message.terminal_reason??null,num_turns:message.num_turns??null,completed_at:new Date().toISOString(),
          response:message.subtype==='success'?boundedText(message.result):boundedText(message.errors.join('\n'),2000),
          usage:{input_tokens:message.usage?.input_tokens??null,output_tokens:message.usage?.output_tokens??null,api_equivalent_cost_usd:message.total_cost_usd??null,
            native_models:plain(message.modelUsage)?Object.keys(message.modelUsage).slice(0,16).map(bounded):[]}};
        // Native confirms an interrupt with an execution error for the same input.
        if (record.interrupt?.turn_id===run.turn && message.subtype==='error_during_execution' && message.is_error)
          record.interrupt.confirmed_at=record.result.completed_at;
        save();
        // One explicit message per run: close input; the run ends when the process exits.
        proc.end();
      }
    });
    this.runs.set(record.id,run);
    const abortBeforePrompt=async heldInitialization=>{
      record.note='The native process did not initialize cleanly; no prompt was sent and session state is unknown.';save();proc.end();proc.kill();
      if(!proc.child)proc.finish(null);
      let timer;
      await Promise.race([finalized,new Promise(resolve=>{timer=setTimeout(resolve,5000);})]);clearTimeout(timer);
      const live=proc.exited&&!heldInitialization&&!proc.malformed&&!proc.refused.length&&!record.ambiguous?await this.liveSessions():null;
      if(Array.isArray(live)&&!live.length&&(!resume||await this.historyConfirms(previous))) {
        for(const key of Object.keys(record))delete record[key];Object.assign(record,previous);save();
        throw Object.assign(new FactoryError('Native Claude initialization failed. No prompt was sent; the previous state is retained. Correct the problem before an explicit retry.',503),{notSent:true});
      }
      throw new FactoryError('Native Claude process did not initialize cleanly; no prompt was sent. Inspect the session before any new work.',503);
    };
    let heldInitialization=false;
    try {
      proc.start();
      const gaps=initializationGaps(await proc.request('initialize',{},20000));
      if (gaps.length) {heldInitialization=true;throw new Error(gaps.join('; '));}
    } catch {
      return abortBeforePrompt(heldInitialization);
    }
    if (record.ambiguous) {proc.end();proc.kill();throw new FactoryError(`${record.ambiguous} No prompt was sent.`,409);}
    record.phase='sent';save();
    try {
      proc.send({type:'user',uuid:input,session_id:record.session_id,parent_tool_use_id:null,message:{role:'user',content:text}});
    } catch(error) {
      if(error.notSent)return abortBeforePrompt(false);
      throw new FactoryError('Native prompt delivery is ambiguous; inspect Claude history before any new work.',503);
    }
    const timer=setTimeout(()=>doubt('Native input confirmation timed out; outcome unknown. No retry was attempted.'),this.confirmTimeout);
    try {await confirmed;} finally {clearTimeout(timer);}
    return this.makeJob(record);
  }
  async interrupt(id,turnId) {
    return withWriterGate(this.config,async()=>{
      if (!this.record(id)) throw new FactoryError('Native issue history not found.',404);
      const run=this.runs.get(id),record=run?.record;
      if (!run || !run.turn || record?.turn_id!==turnId || run.turn!==turnId || record.interrupt?.turn_id===turnId || run.result)
        throw new FactoryError('Native turn is not confirmed running in this bridge, changed, or was already interrupted; inspect status.',409);
      record.interrupt={turn_id:turnId,requested_at:new Date().toISOString(),acknowledged:null,confirmed_at:null};
      record.updated_at=record.interrupt.requested_at;saveReceipt(this.state,record);
      const acknowledged=await run.proc.request('interrupt',{cancel_queued:true}).then(()=>true,()=>false);
      record.interrupt.acknowledged=acknowledged;record.updated_at=new Date().toISOString();saveReceipt(this.state,record);
      if (!acknowledged) throw new FactoryError('Native interrupt outcome is unknown.',503);
      return {id,thread_id:record.session_id,turn_id:turnId,interrupt_requested:true,interrupt_confirmed:Boolean(record.interrupt.confirmed_at)};
    });
  }
  close() {for (const run of this.runs.values()) {run.proc.end();run.proc.kill();}}
}
