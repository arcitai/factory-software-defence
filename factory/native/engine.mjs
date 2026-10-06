import { randomBytes } from 'node:crypto';
import { associateIssue, canonicalIssue } from '../issue-lifecycle.mjs';
import { FactoryError } from '../error.mjs';
import { nativeReadiness } from './app-server.mjs';
import { verifyNativeConfig } from './setup.mjs';
import { codexApprovals, confirmedApprovals } from './codex-approvals.mjs';
import { atomicallyWrite, boundedText, hash, issuePrompt, readReceipts, readWriter as readWriterFile, saveReceipt, validStartInput, withWriterGate, writerPath } from './writer.mjs';

const terminal = new Set(['completed','failed','interrupted']);
const stateOf = status => ({inProgress:'running',completed:'needs_review',failed:'failed',interrupted:'interrupted'})[status] || 'unknown';

function responseText(turn) {
  if (!Array.isArray(turn?.items)) return null;
  const item=[...turn.items].reverse().find(value=>value?.type==='agentMessage' && typeof value.text==='string');
  return item ? boundedText(item.text) : null;
}
function turnMetadata(turn) {
  return {id:turn.id,state:stateOf(turn.status),started_at:turn.startedAt || null,completed_at:turn.completedAt || null};
}
function makeJob(record, status, turns=[], current=null) {
  const runs=turns.slice().reverse().map(turn=>({id:turn.id,command:'codex',state:stateOf(turn.status),started_at:turn.startedAt || null,completed_at:turn.completedAt || null}));
  const now=current || turns.find(turn=>turn.id===record.turn_id) || null;
  const nativeTime=now?.completedAt||now?.startedAt;
  const nativeDate=typeof nativeTime==='number'?new Date(nativeTime<1e12?nativeTime*1000:nativeTime):new Date(nativeTime);
  const activity=nativeTime&&Number.isFinite(nativeDate.getTime())?nativeDate.toISOString():record.updated_at||record.created_at;
  const latestStatus=record.phase==='started' ? status : 'unknown';
  return {id:record.id,native:true,thread_id:record.thread_id || null,turn_id:record.turn_id || null,
    created_at:record.created_at,updated_at:activity,state:latestStatus,
    task:{title:record.title,spec:`Issue content pinned by SHA-256: ${record.spec_hash}`,source_url:record.url},
    workflow:{name:record.work_type || 'software',steps:[],current_step:0},runs,
    native_turn_status:now ? stateOf(now.status) : null,
    native_turns:turns.map(turnMetadata),
    native_result:now ? {completed_at:now.completedAt || null,response:responseText(now),bounded:true} : null,
    native_state_note:record.note || null};
}
const readWriter = config => readWriterFile(config);

export class NativeEngine {
  constructor(state,config,client,provider) {
    this.state=state;this.config=config;this.client=client;this.provider=provider;this.readiness=null;
    client.onNotification(event=>{
      if (event.method!=='native/unexpectedRequest') return;
      const owner=readWriter(config);
      const record=owner?.state===state ? readReceipts(state).find(item=>item.id===owner.job_id) : null;
      if (record?.thread_id && record.turn_id && record.phase==='started')
        client.call('turn/interrupt',{threadId:record.thread_id,turnId:record.turn_id}).catch(()=>{});
    });
  }
  job(record,status,turns=[],current=null) {
    return {...makeJob(record,status,turns,current),native_approvals:{mode:record.approvals||'never',
      ...this.client.approvals?.snapshot(record.thread_id,record.turn_id,this.client.available,status)}};
  }
  async doctor() { this.readiness=await nativeReadiness(this.client,this.config,this.state);return this.readiness; }
  async threadTurns(threadId,{itemsView='notLoaded',limit=100}={}) {
    const {thread}=await this.client.call('thread/read',{threadId,includeTurns:false});
    if (thread?.id!==threadId || thread.cwd!==this.config.repo) return null;
    const page=await this.client.call('thread/turns/list',
      {threadId,itemsView,sortDirection:'desc',limit});
    if (!Array.isArray(page?.data) || page.data.length>limit) return null;
    if (page.data.some(turn=>typeof turn?.id!=='string'||typeof turn.status!=='string')) return null;
    return itemsView==='notLoaded' ? page.data.map(({id,status,startedAt,completedAt})=>({id,status,startedAt,completedAt})) : page.data;
  }
  async observed(record,{itemsView='notLoaded'}={}) {
    if (!record.thread_id || !record.turn_id || !this.client.available) return null;
    const turns=await this.threadTurns(record.thread_id,{itemsView});
    if (!turns) return null;
    const index=turns.findIndex(turn=>turn.id===record.turn_id);
    if (index<0 || index!==0 || record.phase!=='started') return null;
    return {turns,current:turns[0]};
  }
  async assertWorkspaceIdle({allowThread=null}={}) {
    if (!this.client.available) throw new FactoryError('Native state unavailable; workspace ownership is unknown.',503);
    const owner=readWriter(this.config);
    if(owner) {
      if(owner.state!==this.state)throw new FactoryError('Another native installation owns the repository; workspace ownership is unresolved.',409);
      const record=readReceipts(this.state).find(item=>item.id===owner.job_id);
      const observation=record && await this.observed(record).catch(()=>null);
      if(!observation || !terminal.has(observation.current.status))
        throw new FactoryError('Native writer receipt is active or unresolved; preserve it and inspect Codex history.',409);
    }
    let cursor, pages=0;
    do {
      const params={sourceKinds:['cli','vscode','exec','appServer','subAgent','subAgentReview','subAgentCompact','subAgentThreadSpawn','subAgentOther','unknown'],limit:100,sortDirection:'desc'};
      if (cursor) params.cursor=cursor;
      const page=await this.client.call('thread/list',params).catch(()=>null);
      if (!Array.isArray(page?.data) || page.data.length>100) throw new FactoryError('Codex thread inventory is unavailable; workspace ownership is unknown.',409);
      for (const summary of page.data) {
        if (typeof summary?.id!=='string') throw new FactoryError('Codex returned an unidentified session; workspace ownership is unknown.',409);
        const turns=await this.threadTurns(summary.id,{limit:1}).catch(()=>null);
        if (turns===null) {
          // An unavailable thread outside this project is irrelevant only when its
          // identity can be read. Failure to read it is an unresolved owner.
          const read=await this.client.call('thread/read',{threadId:summary.id,includeTurns:false}).catch(()=>null);
          if (read?.thread?.id!==summary.id || typeof read.thread.cwd!=='string' || !read.thread.cwd)
            throw new FactoryError('Codex session identity is unavailable; workspace ownership is unknown.',409);
          if (read.thread.cwd===this.config.repo) throw new FactoryError('A project Codex thread cannot be reconciled; workspace ownership is unknown.',409);
          continue;
        }
        const read=await this.client.call('thread/read',{threadId:summary.id,includeTurns:false}).catch(()=>null);
        if (read?.thread?.id!==summary.id) throw new FactoryError('Codex session identity is unavailable; workspace ownership is unknown.',409);
        if (read.thread.cwd!==this.config.repo || summary.id===allowThread) continue;
        const latest=turns[0];
        if (!latest || !terminal.has(latest.status))
          throw new FactoryError('Another native Codex session is active or unresolved in this workspace.',409);
      }
      cursor=page.nextCursor || null;
      if (cursor && ++pages>=20) throw new FactoryError('Codex session inventory exceeds the safe reconciliation limit.',409);
    } while (cursor);
  }
  async withGate(action) { return withWriterGate(this.config,action); }
  async replaceWriter(record,{continuation=false,expectedTurnId=null}={}) {
    const path=writerPath(this.config),previous=readWriter(this.config);
    if (previous) {
      if (previous.state!==this.state) throw new FactoryError('Another native installation owns this repository. Reconcile its writer before admission.',409);
      const prior=readReceipts(this.state).find(item=>item.id===previous.job_id);
      if (!prior) throw new FactoryError('Native writer receipt has no issue association. Preserve it and inspect Codex history.',409);
      const observation=await this.observed(prior).catch(()=>null);
      if (!observation || !terminal.has(observation.current.status))
        throw new FactoryError('Native workspace has active or unresolved work. Inspect its Codex thread before admission.',409);
      if (continuation && prior.id===record.id && prior.turn_id===expectedTurnId) {
        // The explicit continuation owns the same already-terminal thread.
      } else if (continuation && prior.id!==record.id) {
        // A different completed Factory thread can be replaced only after the
        // full project session inventory below also confirms no active writer.
      }
    }
    await this.assertWorkspaceIdle({allowThread:continuation?record.thread_id:null});
    atomicallyWrite(path,{job_id:record.id,state:this.state,repo:this.config.repo,updated_at:new Date().toISOString()});
  }
  async jobs() {
    const receipts=readReceipts(this.state),result=[];
    for (const record of receipts) {
      if (!record.thread_id || !record.turn_id || record.phase!=='started' || !this.client.available) {
        result.push(this.job(record,'unknown'));continue;
      }
      try {
        const observation=await this.observed(record,{itemsView:'notLoaded'});
        result.push(observation ? this.job(record,stateOf(observation.current.status),observation.turns,observation.current) : this.job(record,'unknown'));
      } catch {result.push(this.job(record,'unknown'));}
    }
    return result;
  }
  async result(id) {
    const record=readReceipts(this.state).find(item=>item.id===id);
    if(!record)throw new FactoryError('Native issue history not found.',404);
    if(!this.client.available)return this.job(record,'unknown');
    try {
      const observation=await this.observed(record,{itemsView:'notLoaded'});
      if(!observation)return this.job(record,'unknown');
      const latest=await this.threadTurns(record.thread_id,{itemsView:'summary',limit:1});
      if(!latest || latest[0]?.id!==record.turn_id)return this.job(record,'unknown');
      return this.job(record,stateOf(observation.current.status),observation.turns,latest[0]);
    } catch {return this.job(record,'unknown');}
  }
  async issue(input) {
    const issue=await this.provider.preview(input.url);
    return associateIssue(issue,await this.jobs());
  }
  async start(input) {
    if (!this.client.available) throw new FactoryError('Native state unavailable; no work was started.',503);
    const workType=validStartInput(input);
    const ready=await this.doctor();if (!ready.ready) throw new FactoryError(`Native readiness failed: ${ready.gaps.join('; ')}`,503);
    const issue=await this.issue(input);
    if (issue.spec!==input.expected_spec) throw new FactoryError('Issue content changed. Refresh before starting.',409);
    if (issue.start_block_reason) throw new FactoryError(issue.start_block_reason,409);
    const identity=canonicalIssue(issue.url);
    if (!identity) throw new FactoryError('Unsupported issue identity.',400);
    try {verifyNativeConfig(this.state,this.config);} catch {throw new FactoryError('Native permissions configuration changed; admission refused.',503);}
    const record={id:`job_${randomBytes(12).toString('hex')}`,key:identity.key,url:identity.url,title:issue.title,
      work_type:workType,approvals:this.config.approvals||'never',spec_hash:hash(issue.spec),created_at:new Date().toISOString(),phase:'reserved',thread_id:null,turn_id:null,attempts:[]};
    return this.withGate(async()=>{
      if (readReceipts(this.state).some(item=>item.key===identity.key))
        throw new FactoryError('Issue already has native history or unresolved admission. Continue its recorded thread.',409);
      await this.replaceWriter(record);
      try {saveReceipt(this.state,record,true);}
      catch(error) {
        if(error.code==='EEXIST')throw new FactoryError('Issue already has native history or unresolved admission.',409);
        throw error;
      }
      // The writer and admission receipts are durable before the first native side effect.
      verifyNativeConfig(this.state,this.config);
      const finalReadiness=await this.doctor();
      if (!finalReadiness.ready) throw new FactoryError('Native effective permissions changed during admission; reservation remains unresolved.',503);
      const started=await this.client.call('thread/start',{cwd:this.config.repo,permissions:'factory',...codexApprovals(this.config),allowProviderModelFallback:false,ephemeral:false},30000);
      if (started?.thread?.id) {record.thread_id=started.thread.id;record.phase='thread_started';saveReceipt(this.state,record);}
      if (!record.thread_id || started.cwd!==this.config.repo || !confirmedApprovals(started,this.config)
        || started.activePermissionProfile?.id!=='factory') throw new Error('Native thread did not confirm its permissions or identity; admission remains reserved.');
      const prompt=issuePrompt({url:identity.url,specHash:record.spec_hash,spec:issue.spec,brief:input.brief,workType});
      const turn=await this.client.call('turn/start',{threadId:record.thread_id,input:[{type:'text',text:prompt}],permissions:'factory',...codexApprovals(this.config)},30000);
      if (!turn?.turn?.id) throw new Error('Native turn response was ambiguous; inspect the thread before any new work.');
      record.turn_id=turn.turn.id;record.phase='started';record.attempts.push({turn_id:record.turn_id,started_at:new Date().toISOString()});record.updated_at=new Date().toISOString();saveReceipt(this.state,record);
      if (this.client.unexpectedApproval) await this.client.call('turn/interrupt',{threadId:record.thread_id,turnId:record.turn_id}).catch(()=>{});
      return this.job(record,stateOf(turn.turn.status),[turn.turn],turn.turn);
    });
  }
  async continue(id,expectedTurnId,feedback) {
    const record=readReceipts(this.state).find(item=>item.id===id);
    if (!record) throw new FactoryError('Native issue history not found.',404);
    if (typeof expectedTurnId!=='string' || !expectedTurnId || typeof feedback!=='string' || !feedback.trim() || feedback.length>16000)
      throw new FactoryError('Continue requires the expected terminal turn ID and operator feedback of at most 16,000 characters.',400);
    if (!record.thread_id || record.phase!=='started' || !this.client.available)
      throw new FactoryError('Native thread or state is unresolved; inspect Codex history before continuing.',409);
    const ready=await this.doctor();if(!ready.ready)throw new FactoryError(`Native readiness failed: ${ready.gaps.join('; ')}`,503);
    try {verifyNativeConfig(this.state,this.config);} catch {throw new FactoryError('Native permissions configuration changed; continuation refused.',503);}
    return this.withGate(async()=>{
      const fresh=readReceipts(this.state).find(item=>item.id===id);
      if (!fresh || fresh.turn_id!==expectedTurnId) throw new FactoryError('Expected terminal turn changed. Refresh status before continuing.',409);
      const observation=await this.observed(fresh).catch(()=>null);
      if (!observation || observation.current.id!==expectedTurnId || !terminal.has(observation.current.status))
        throw new FactoryError('Expected turn is active, stale or ambiguous. Inspect native history before continuing.',409);
      await this.replaceWriter(fresh,{continuation:true,expectedTurnId});
      fresh.phase='continue_reserved';fresh.expected_turn_id=expectedTurnId;fresh.updated_at=new Date().toISOString();
      fresh.attempts=[...(fresh.attempts||[]),{expected_turn_id:expectedTurnId,reserved_at:fresh.updated_at,phase:'reserved'}];
      saveReceipt(this.state,fresh);
      const resumed=await this.client.call('thread/resume',{threadId:fresh.thread_id,cwd:this.config.repo,permissions:'factory',...codexApprovals(this.config),excludeTurns:true});
      if(resumed?.thread?.id!==fresh.thread_id || resumed.cwd!==this.config.repo || !confirmedApprovals(resumed,this.config)
        || resumed.activePermissionProfile?.id!=='factory')throw new FactoryError('Native resume did not confirm its permissions; continuation reservation remains unresolved.',503);
      const turn=await this.client.call('turn/start',{threadId:fresh.thread_id,input:[{type:'text',text:feedback.trim()}],permissions:'factory',...codexApprovals(this.config)},30000);
      if (!turn?.turn?.id) throw new Error('Native continuation response was ambiguous; inspect the thread before any new work.');
      fresh.turn_id=turn.turn.id;fresh.phase='started';fresh.approvals=this.config.approvals||'never';delete fresh.expected_turn_id;
      fresh.attempts[fresh.attempts.length-1]={turn_id:turn.turn.id,expected_turn_id:expectedTurnId,started_at:new Date().toISOString()};
      fresh.updated_at=new Date().toISOString();saveReceipt(this.state,fresh);
      if(this.client.unexpectedApproval)await this.client.call('turn/interrupt',{threadId:fresh.thread_id,turnId:fresh.turn_id}).catch(()=>{});
      return this.job(fresh,stateOf(turn.turn.status),[turn.turn],turn.turn);
    });
  }
  async interrupt(id,turnId) {
    if(!this.client.available)throw new FactoryError('Native state unavailable; interrupt outcome unknown.',503);
    return this.withGate(async()=>{
      const record=readReceipts(this.state).find(item=>item.id===id);
      if(!record)throw new FactoryError('Native issue history not found.',404);
      if(!record.thread_id || !record.turn_id || record.turn_id!==turnId || record.phase!=='started' || record.interrupt_turn_id===turnId)
        throw new FactoryError('Native turn changed, was already interrupted, or is unresolved; inspect status.',409);
      const observation=await this.observed(record).catch(()=>null);
      if(observation?.current.status!=='inProgress')throw new FactoryError('Native turn is not confirmed running; inspect Codex history.',409);
      record.interrupt_turn_id=turnId;record.updated_at=new Date().toISOString();saveReceipt(this.state,record);
      await this.client.call('turn/interrupt',{threadId:record.thread_id,turnId});
      return {id,thread_id:record.thread_id,turn_id:turnId,interrupt_requested:true};
    });
  }
  async resume(id) {
    const record=readReceipts(this.state).find(item=>item.id===id);
    if(!record?.thread_id)throw new FactoryError('Native thread identity is unresolved; inspect Codex history.',409);
    if(!this.client.available)throw new FactoryError('Native state unavailable; reconnect outcome unknown.',503);
    const observation=await this.observed(record).catch(()=>null);
    if (!observation) throw new FactoryError('Recorded native turn is stale or unavailable; reconnect blocked.',409);
    const ready=await this.doctor();if(!ready.ready)throw new FactoryError(`Native readiness failed: ${ready.gaps.join('; ')}`,503);
    const resumed=await this.client.call('thread/resume',{threadId:record.thread_id,cwd:this.config.repo,permissions:'factory',...codexApprovals(this.config),excludeTurns:true});
    if(resumed?.thread?.id!==record.thread_id || resumed.cwd!==this.config.repo || !confirmedApprovals(resumed,this.config)
      || resumed.activePermissionProfile?.id!=='factory')throw new FactoryError('Native resume did not confirm its permissions; no turn was started.',503);
    return {id,thread_id:record.thread_id,resumed:true,turn_started:false};
  }
}
