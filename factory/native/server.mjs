import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { providerInfo } from '../issue-provider.mjs';
import { associateIssue, backlogHistory, readinessMapping, workRecords } from '../issue-lifecycle.mjs';
import { readProjectLinks } from '../project-links.mjs';
import { recommendWork } from '../intake.mjs';
import { FactoryError } from '../error.mjs';
import { NativeIssueSubmissions } from './issue-submissions.mjs';

const ui=join(fileURLToPath(new URL('../../',import.meta.url)),'factory','ui');
const equal=(a,b)=>typeof a==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function body(request) {
  let data='';for await(const chunk of request){data+=chunk;if(Buffer.byteLength(data)>256000)throw new FactoryError('Request too large',413);}
  try { const parsed=JSON.parse(data);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();return parsed; }
  catch { throw new FactoryError('Expected a JSON object',400); }
}
export function createNativeServer(state,config,{harness,provider,instance=randomBytes(16).toString('hex'),maintenanceToken=null}={}) {
  if(!harness||!provider||typeof harness.jobs!=='function'||typeof harness.doctor!=='function')throw new Error('Native server needs an owning harness and issue provider.');
  const engine=harness,submissions=new NativeIssueSubmissions(state,provider),csrf=randomBytes(32).toString('hex');
  const invoke=(name,...args)=>{if(typeof engine[name]!=='function')throw new FactoryError('This harness capability is unavailable.',404);return engine[name](...args);};
  if(maintenanceToken!==null && (typeof maintenanceToken!=='string'||!/^[a-zA-Z0-9-]{16,100}$/.test(maintenanceToken)))
    throw new Error('Pending service adoption has an invalid maintenance token.');
  let maintenance=maintenanceToken?{token:maintenanceToken,phase:'startup'}:null,inFlight=0;
  const waitForWrites=()=>new Promise((resolve,reject)=>{
    if(inFlight===0)return resolve();
    const poll=setInterval(()=>{if(inFlight===0){clearInterval(poll);clearTimeout(deadline);resolve();}},20);
    const deadline=setTimeout(()=>{clearInterval(poll);reject(new FactoryError('Admitted writes are still in flight; maintenance refused.',409));},30000);
  });
  const assertIdle=async()=>{
    const jobs=await engine.jobs();
    if(jobs.some(job=>job.state==='running'||job.state==='unknown'))throw new FactoryError('Native work is active or unresolved.',409);
    await engine.assertWorkspaceIdle();
  };
  const server=http.createServer(async(request,response)=>{
    const send=(status,value,type='application/json; charset=utf-8')=>{response.writeHead(status,{'Content-Type':type});response.end(type.startsWith('application/json')?JSON.stringify(value):value);};
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: https://avatars.githubusercontent.com; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const hosts=[`localhost:${server.address().port}`,`127.0.0.1:${server.address().port}`];
      if(!hosts.includes(request.headers.host))throw new FactoryError('Host is not allowed',403);
      if(request.headers.origin && !hosts.map(host=>`http://${host}`).includes(request.headers.origin))throw new FactoryError('Origin is not allowed',403);
      if(request.headers['sec-fetch-site']==='cross-site')throw new FactoryError('Cross-site access is not allowed',403);
      // A restart-only gate follows the durable receipt; explicit maintenance
      // remains held until its owner cancels it.
      if(maintenance?.phase==='startup'&&!existsSync(join(state,'service-adoption.json')))maintenance=null;
      const url=new URL(request.url,`http://${request.headers.host}`);
      const authenticated=equal(request.headers['x-factory-session'],csrf);
      if(request.method==='GET'&&url.pathname==='/api/v1/bridge/status')
        return send(200,{version:1,native:true,native_instance:instance,repo:config.repo,csrf_token:csrf});
      if(request.method==='GET'&&url.pathname==='/api/v1/status') {
        const jobs=await engine.jobs(),ready=await engine.doctor().catch(()=>({ready:false,gaps:['Native state unavailable']}));
        return send(200,{version:1,native:true,native_instance:instance,maintenance_prepared:Boolean(maintenance),native_capabilities:{issue_start:Boolean(provider.supported)&&typeof engine.start==='function',interrupt:typeof engine.interrupt==='function',
          resume_thread:typeof engine.resume==='function',continue_turn:typeof engine.continue==='function',result:typeof engine.result==='function',issue_create:Boolean(provider.capabilities?.create),local_request:false},
          native_readiness:ready,csrf_token:csrf,repo:config.repo,project_links:readProjectLinks(config.repo) || null,harness:engine.name || 'native',agent:engine.name || 'native',
          jobs,issue_history:backlogHistory(jobs,[]),work_records:workRecords(jobs,[]),issue_provider:providerInfo(provider),
          work_types:['software','defensive'],workflows:['software','defensive'],
          infrastructure:{native:{connected:engine.available}}});
      }
      const nativeResult=url.pathname.match(/^\/api\/v1\/jobs\/(job_[a-f0-9]+)\/result$/);
      if(request.method==='GET'&&nativeResult) {
        if(!authenticated)throw new FactoryError('Session required',403);
        return send(200,await invoke('result',nativeResult[1]));
      }
      if(request.method==='GET'&&url.pathname==='/api/v1/issues') {
        if(!authenticated)throw new FactoryError('Session required',403);
        const page=Number(url.searchParams.get('page')||1),stateFilter=url.searchParams.get('state')||'open';
        if(!Number.isSafeInteger(page)||page<1||page>10000||!['open','closed','all'].includes(stateFilter))throw new FactoryError('Choose a valid issue page and state.',400);
        const result=provider.supported?await provider.list(page,stateFilter):{repository:provider.repository,issues:[],next_page:null};
        const jobs=await engine.jobs(),issues=result.issues.map(issue=>associateIssue(issue,jobs,readinessMapping()));
        return send(200,{...result,issues,provider:providerInfo(provider),page,state:stateFilter,loaded_count:issues.length,total:null,history:backlogHistory(jobs,issues),work_records:workRecords(jobs,issues)});
      }
      if(request.method==='GET'&&url.pathname==='/api/v1/issue-connection') {
        if(!authenticated)throw new FactoryError('Session required',403);
        return send(200,{...providerInfo(provider),...(provider.supported?await provider.context():{})});
      }
      if(request.method==='GET'&&url.pathname==='/api/v1/issue-submissions') {
        if(!authenticated)throw new FactoryError('Session required',403);return send(200,submissions.list());
      }
      if(request.method==='GET'&&url.pathname==='/api/v1/issue-templates') {
        if(!authenticated)throw new FactoryError('Session required',403);return send(200,await provider.templates());
      }
      if(request.method==='POST') {
        if(!authenticated)throw new FactoryError('Session required',403);
        if(!(request.headers['content-type']||'').startsWith('application/json'))throw new FactoryError('Use application/json',415);
        const input=await body(request);
        if(url.pathname==='/api/v1/maintenance/cancel') {
          if(input.instance!==instance||(maintenance&&(maintenance.phase!=='prepared'||input.token!==maintenance.token)))
            throw new FactoryError('Maintenance ownership changed or preparation is still in progress.',409);
          maintenance=null;return send(200,{instance,prepared:false});
        }
        if(url.pathname==='/api/v1/maintenance/prepare') {
          if(input.instance!==instance)throw new FactoryError('Native instance changed.',409);
          if(typeof input.token!=='string'||!/^[a-zA-Z0-9-]{16,100}$/.test(input.token))throw new FactoryError('Maintenance needs a unique operation token.',400);
          if(maintenance?.token===input.token && ['prepared','startup'].includes(maintenance.phase)) {
            await waitForWrites();await assertIdle();maintenance.phase='prepared';
            return send(200,{instance,token:maintenance.token,prepared:true});
          }
          if(maintenance)throw new FactoryError('Maintenance is already prepared.',409);
          const owner={token:input.token,phase:'preparing'};maintenance=owner;
          try {await waitForWrites();await assertIdle();owner.phase='prepared';return send(200,{instance,token:owner.token,prepared:true});}
          catch(error){if(maintenance===owner)maintenance=null;throw error;}
        }
        if(maintenance||existsSync(join(state,'service-adoption.json')))
          throw new FactoryError('Service adoption or maintenance is pending; new writes are blocked.',409);
        inFlight++;
        try {
        if(url.pathname==='/api/v1/issues')return send(201,await submissions.create(input));
        const recover=url.pathname.match(/^\/api\/v1\/issue-submissions\/([A-Za-z0-9_-]{16,100})\/recover$/);
        if(recover)return send(200,await submissions.recover(recover[1]));
        if(url.pathname==='/api/v1/issue-templates/draft')return send(200,await provider.draft(input));
        if(url.pathname==='/api/v1/intake/recommend')return send(200,recommendWork(input));
        if(url.pathname==='/api/v1/issues/preview')return send(200,await invoke('issue',input));
        if(url.pathname==='/api/v1/issues/start')return send(201,await invoke('start',input));
        const id=url.pathname.match(/^\/api\/v1\/jobs\/(job_[a-f0-9]+)\/(continue|interrupt|resume)$/);
        if(id) {
          if(id[2]==='continue')return send(200,await invoke('continue',id[1],input.expected_turn_id,input.feedback));
          if(id[2]==='interrupt')return send(200,await invoke('interrupt',id[1],input.turn_id));
          return send(200,await invoke('resume',id[1]));
        }
        } finally {inFlight--;}
      }
      const asset=url.pathname.match(/^\/assets\/([\w.-]+\.(js|css|woff2))$/);
      if(request.method==='GET'&&(url.pathname==='/'||asset)) {
        const name=asset?`assets/${asset[1]}`:'index.html',path=join(ui,name),types={js:'text/javascript',css:'text/css',woff2:'font/woff2'};
        if(!existsSync(path))throw new FactoryError('Asset not found',404);
        return send(200,readFileSync(path),asset?types[asset[2]]:'text/html; charset=utf-8');
      }
      throw new FactoryError('Native capability unavailable',404);
    } catch(error) {send(error.status||503,{error:error.status?error.message:'Native state unavailable; inspect private server logs.'});}
  });
  server.requestTimeout=45000;server.headersTimeout=15000;
  return {server,engine};
}
