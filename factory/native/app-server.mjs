import { spawn } from 'node:child_process';
import { nativeEnvironment, nativePolicy, verifyNativeConfig } from './setup.mjs';
import { ApprovalObservations, codexApprovals, confirmedApprovals } from './codex-approvals.mjs';

const MAX_FRAME = 16 * 1024 * 1024;
const MAX_PENDING = 32;
const unavailable = () => new Error('Native state unavailable; inspect the Codex session locally.');
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const withoutNulls = value => {
  if (Array.isArray(value)) return value.map(withoutNulls);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().filter(key=>value[key] !== null).map(key=>[key,withoutNulls(value[key])]));
};
const same = (left,right) => JSON.stringify(withoutNulls(left)) === JSON.stringify(withoutNulls(right));

export class AppServer {
  constructor({ config, env }) {
    this.config=config; this.env=env; this.pending=new Map(); this.next=1;
    this.available=false; this.listeners=new Set(); this.unexpectedApproval=false;
    this.approvals=new ApprovalObservations();
    this.buffer=Buffer.alloc(0);this.discarding=false;
  }
  async connect() {
    this.child=spawn(this.config.codex,['app-server','--strict-config'],
      {cwd:this.config.repo,env:this.env,stdio:['pipe','pipe','pipe']});
    this.child.stderr.on('data',()=>{});
    this.child.once('error',()=>this.close());
    this.child.once('close',()=>{this.child=null;this.disconnect();});
    this.child.stdout.on('data',chunk=>this.read(chunk));
    try {
      const initialized=await this.call('initialize',{clientInfo:{name:'factory-native',version:'0.1.0'},capabilities:{experimentalApi:true}});
      if (initialized?.codexHome !== this.env.CODEX_HOME || initialized.platformOs !== 'linux'
        || initialized.platformFamily !== 'unix') throw unavailable();
      this.send({method:'initialized'});
      this.available=true;
      return this;
    } catch { this.close(); throw unavailable(); }
  }
  read(chunk) {
    let offset=0;
    while(offset<chunk.length) {
      const end=chunk.indexOf(10,offset);
      if(this.discarding) {
        if(end<0)return;
        this.discarding=false;offset=end+1;continue;
      }
      const part=chunk.subarray(offset,end<0?chunk.length:end);
      if(this.buffer.length+part.length>MAX_FRAME) {
        this.buffer=Buffer.alloc(0);
        if(end<0){this.discarding=true;return;}
        offset=end+1;continue;
      }
      this.buffer=Buffer.concat([this.buffer,part]);
      if(end<0)return;
      const line=this.buffer.toString('utf8');this.buffer=Buffer.alloc(0);
      this.receive(line);
      if(!this.child)return;
      offset=end+1;
    }
  }
  disconnect() {
    if (!this.child && !this.available && !this.pending.size) return;
    this.available=false;
    for (const {reject,timer} of this.pending.values()) {clearTimeout(timer); reject(unavailable());}
    this.pending.clear();
    for (const listener of this.listeners) listener({method:'native/disconnected'});
  }
  send(value) {
    if (!this.child?.stdin?.writable) throw unavailable();
    const frame=`${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(frame)>MAX_FRAME) throw unavailable();
    this.child.stdin.write(frame);
  }
  call(method,params={},timeout=15000) {
    if (!this.child?.stdin?.writable || this.pending.size>=MAX_PENDING) return Promise.reject(unavailable());
    const id=this.next++;
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{this.pending.delete(id);reject(unavailable());},timeout);
      this.pending.set(id,{resolve,reject,timer});
      try {this.send({id,method,params});} catch {clearTimeout(timer);this.pending.delete(id);reject(unavailable());this.close();}
    });
  }
  receive(line) {
    let value;
    try {value=JSON.parse(line);} catch {return this.close();}
    if (!plain(value)) return this.close();
    if (Object.hasOwn(value,'id') && !value.method) {
      const pending=this.pending.get(value.id);
      if (!pending && Number.isSafeInteger(value.id) && value.id>0 && value.id<this.next) return;
      if (!pending || (Object.hasOwn(value,'result')===Object.hasOwn(value,'error'))) return this.close();
      clearTimeout(pending.timer); this.pending.delete(value.id);
      if (value.error) pending.reject(unavailable());
      else pending.resolve(value.result);
      return;
    }
    if (Object.hasOwn(value,'id') && typeof value.method==='string') {
      this.unexpectedApproval=true;
      const decisions={
        'item/commandExecution/requestApproval':'cancel', 'item/fileChange/requestApproval':'cancel',
        execCommandApproval:'abort', applyPatchApproval:'abort',
      };
      try {
        if (decisions[value.method]) this.send({id:value.id,result:{decision:decisions[value.method]}});
        else if (value.method==='mcpServer/elicitation/request') this.send({id:value.id,result:{action:'cancel'}});
        else this.send({id:value.id,error:{code:-32000,message:'Request refused.'}});
      } catch {return this.close();}
      for (const listener of this.listeners) listener({method:'native/unexpectedRequest'});
      if (typeof value.params?.threadId==='string' && typeof value.params?.turnId==='string')
        this.call('turn/interrupt',{threadId:value.params.threadId,turnId:value.params.turnId}).catch(()=>{});
      return;
    }
    if (typeof value.method !== 'string' || Object.hasOwn(value,'id')) return this.close();
    this.approvals.observe(value.method,value.params);
    if(value.method==='thread/settings/updated' && (!confirmedApprovals(value.params?.threadSettings,this.config)
      || value.params?.threadSettings?.cwd!==this.config.repo
      || value.params?.threadSettings?.activePermissionProfile?.id!=='factory')) {
      this.unexpectedApproval=true;
      for(const listener of this.listeners)listener({method:'native/unexpectedRequest'});
    }
    // Raw notifications, including review rationale/actions, can contain private
    // commands or payloads. Only the allowlisted observation above reaches UI.
  }
  onNotification(listener) {this.listeners.add(listener);return ()=>this.listeners.delete(listener);}
  close() {
    const child=this.child;
    this.child=null;
    if (child?.kill) {
      child.kill('SIGTERM');
      const timer=setTimeout(()=>{if (child.exitCode===null) child.kill('SIGKILL');},2000);
      timer.unref();
    }
    this.disconnect();
  }
}

export async function nativeReadiness(client, config, state) {
  if (!client.available) return {ready:false,gaps:['Native state unavailable'],account:'unknown',permissions:'unknown',connections:'unknown'};
  const gaps=[];
  if (state) {
    try {verifyNativeConfig(state,config);} catch {gaps.push('Native permissions configuration changed');}
  }
  const expectedEnv=state ? nativeEnvironment(config,state) : client.env;
  if (!same(client.env,expectedEnv) || client.env?.CODEX_HOME !== client.env?.HOME+'/.codex'
    || Object.keys(client.env||{}).sort().join(',') !== 'CODEX_HOME,HOME,LANG,PATH,TMPDIR')
    gaps.push('Native child environment changed');
  const account=await client.call('account/read',{}).catch(()=>null);
  if (!account?.account) gaps.push('Native login required or account state unavailable');
  const selectedApprovals=codexApprovals(config);
  if(config.approvals==='auto-review'&&account?.account?.type!=='chatgpt')
    gaps.push('Auto-review requires a native ChatGPT login; this account is unqualified');
  const effective=await client.call('config/read',{cwd:config.repo,includeLayers:true}).catch(()=>null);
  if (!plain(effective?.config) || !Array.isArray(effective.layers)) gaps.push('Effective Codex configuration unavailable');
  else {
    const cfg=withoutNulls(effective.config);
    const policy=state ? nativePolicy(config,state) : null;
    const selectedFeatures=policy?.features || {};
    const featuresMatch=Object.entries(selectedFeatures).every(([name,enabled])=>cfg.features?.[name]===enabled);
    if (cfg.approval_policy!==selectedApprovals.approvalPolicy
      || (cfg.approvals_reviewer??'user')!==selectedApprovals.approvalsReviewer
      || cfg.web_search!=='disabled' || cfg.cli_auth_credentials_store!=='file'
      || cfg.apps?._default?.enabled!==false || Object.keys(cfg.apps||{}).some(key=>key!=='_default')
      || Object.keys(cfg.tools||{}).length || Object.keys(cfg.browser_use||{}).length
      || Object.keys(cfg.computer_use||{}).length || cfg.desktop || cfg.browser
      || Object.keys(cfg.mcp_servers||{}).length || cfg.connectors
      || cfg.sandbox_mode || Object.keys(cfg.plugins||{}).length || cfg.hooks || cfg.image_generation || cfg.tool_suggest
      || cfg.default_permissions!=='factory'
      || !same(cfg.permissions,policy?.permissions)
      || !featuresMatch || ['network_proxy','remote_control','memories'].some(name=>cfg.features?.[name]===true)
      || !same(cfg.shell_environment_policy,policy?.shell_environment_policy))
      gaps.push('Effective Codex capabilities changed');
    const user=effective.layers.filter(layer=>layer.name?.type==='user' && layer.name?.file===`${client.env.CODEX_HOME}/config.toml`);
    // Model selection remains a native Codex preference. All access settings
    // still match the pinned profile and the on-disk configuration hash.
    const userAccess = Object.fromEntries(Object.entries(user[0]?.config||{})
      .filter(([key])=>!['model','model_reasoning_effort'].includes(key)));
    if (user.length!==1 || !state || !same(userAccess,nativePolicy(config,state)))
      gaps.push('Effective Factory permission profile differs from pinned configuration');
    for (const layer of effective.layers) {
      if (layer===user[0]) continue;
      if (!same(layer.config,{})) gaps.push('Unreviewed effective configuration layer');
    }
  }
  const profiles=await client.call('permissionProfile/list',{cwd:config.repo}).catch(()=>null);
  if (!profiles?.data?.some(profile=>profile.id==='factory'&&profile.allowed===true) || profiles.nextCursor)
    gaps.push('Factory permission profile unavailable or incomplete');
  const apps=await client.call('app/installed',{}).catch(()=>null);
  const mcp=await client.call('mcpServerStatus/list',{}).catch(()=>null);
  if (!Array.isArray(apps?.apps) || apps.apps.length) gaps.push('Installed app status unavailable or nonempty');
  if (!Array.isArray(mcp?.data) || mcp.data.length || mcp.nextCursor) gaps.push('MCP server status unavailable or nonempty');
  if (client.unexpectedApproval) gaps.push('Unexpected native authority request was refused');
  return {ready:gaps.length===0,gaps,account:account?.account?'present':'unavailable',
    approvals:config.approvals||'never',reviewer:selectedApprovals.approvalsReviewer,
    auto_review_qualification:config.approvals==='auto-review'?'requires installed execution proof':'not selected',
    permissions:profiles?.data?.some(p=>p.id==='factory'&&p.allowed)?'factory allowed':'unavailable',
    connections:apps&&mcp?'checked':'unavailable'};
}
