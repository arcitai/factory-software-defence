import http from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { issueProvider, providerInfo } from '../issue-provider.mjs';
import { associateIssue, backlogHistory, readinessMapping, workRecords } from '../issue-lifecycle.mjs';
import { recommendWork } from '../intake.mjs';
import { readProjectLinks } from '../project-links.mjs';
import { QueueError } from '../error.mjs';
import { NativeEngine } from './engine.mjs';
import { NativeIssueSubmissions } from './issue-submissions.mjs';

const ui=join(fileURLToPath(new URL('../../',import.meta.url)),'factory','ui');
const equal=(a,b)=>typeof a==='string' && Buffer.byteLength(a)===Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a),Buffer.from(b));
async function body(request) {
  let data='';for await(const chunk of request){data+=chunk;if(Buffer.byteLength(data)>256000)throw new QueueError('Request too large',413);}
  try { const parsed=JSON.parse(data);if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error();return parsed; }
  catch { throw new QueueError('Expected a JSON object',400); }
}
export function createNativeServer(state,config,client,{provider=issueProvider(config.repo)}={}) {
  const engine=new NativeEngine(state,config,client,provider),submissions=new NativeIssueSubmissions(state,provider),csrf=randomBytes(32).toString('hex');
  const server=http.createServer(async(request,response)=>{
    const send=(status,value,type='application/json; charset=utf-8')=>{response.writeHead(status,{'Content-Type':type});response.end(type.startsWith('application/json')?JSON.stringify(value):value);};
    response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Referrer-Policy','no-referrer');
    response.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const hosts=[`localhost:${server.address().port}`,`127.0.0.1:${server.address().port}`];
      if(!hosts.includes(request.headers.host))throw new QueueError('Host is not allowed',403);
      if(request.headers.origin && !hosts.map(host=>`http://${host}`).includes(request.headers.origin))throw new QueueError('Origin is not allowed',403);
      if(request.headers['sec-fetch-site']==='cross-site')throw new QueueError('Cross-site access is not allowed',403);
      const url=new URL(request.url,`http://${request.headers.host}`);
      const authenticated=equal(request.headers['x-factory-session'],csrf);
      if(request.method==='GET'&&url.pathname==='/api/v1/status') {
        const jobs=await engine.jobs(),ready=await engine.doctor().catch(()=>({ready:false,gaps:['Native state unavailable']}));
        return send(200,{version:1,native:true,native_capabilities:{issue_start:Boolean(provider.supported),interrupt:true,
          resume_thread:true,follow_up_turn:false,issue_create:Boolean(provider.capabilities?.create),local_request:false,legacy_actions:false},
          native_readiness:ready,csrf_token:csrf,repo:config.repo,project_links:readProjectLinks(config.repo) || null,source_ref_default:'HEAD',harness:'codex',agent:'codex',
          jobs,issue_history:backlogHistory(jobs,[]),work_records:workRecords(jobs,[]),issue_provider:providerInfo(provider),
          workflows:['software'],commands:[],triggers:[],repositories:['app'],workers:[],infrastructure:{controller:{connected:client.available}}});
      }
      if(request.method==='GET'&&url.pathname==='/api/v1/issues') {
        if(!authenticated)throw new QueueError('Session required',403);
        const page=Number(url.searchParams.get('page')||1),stateFilter=url.searchParams.get('state')||'open';
        if(!Number.isSafeInteger(page)||page<1||page>10000||!['open','closed','all'].includes(stateFilter))throw new QueueError('Choose a valid issue page and state.',400);
        const result=provider.supported?await provider.list(page,stateFilter):{repository:provider.repository,issues:[],next_page:null};
        const jobs=await engine.jobs(),issues=result.issues.map(issue=>associateIssue(issue,jobs,readinessMapping()));
        return send(200,{...result,issues,provider:providerInfo(provider),page,state:stateFilter,loaded_count:issues.length,total:null,history:backlogHistory(jobs,issues),work_records:workRecords(jobs,issues)});
      }
      if(request.method==='GET'&&url.pathname==='/api/v1/issue-connection') {
        if(!authenticated)throw new QueueError('Session required',403);
        return send(200,{...providerInfo(provider),...(provider.supported?await provider.context():{})});
      }
      if(request.method==='GET'&&url.pathname==='/api/v1/issue-submissions') {
        if(!authenticated)throw new QueueError('Session required',403);return send(200,submissions.list());
      }
      if(request.method==='GET'&&url.pathname==='/api/v1/issue-templates') {
        if(!authenticated)throw new QueueError('Session required',403);return send(200,await provider.templates());
      }
      if(request.method==='POST') {
        if(!authenticated)throw new QueueError('Session required',403);
        if(!(request.headers['content-type']||'').startsWith('application/json'))throw new QueueError('Use application/json',415);
        const input=await body(request);
        if(url.pathname==='/api/v1/issues')return send(201,await submissions.create(input));
        const recover=url.pathname.match(/^\/api\/v1\/issue-submissions\/([A-Za-z0-9_-]{16,100})\/recover$/);
        if(recover)return send(200,await submissions.recover(recover[1]));
        if(url.pathname==='/api/v1/issue-templates/draft')return send(200,await provider.draft(input));
        if(url.pathname==='/api/v1/issues/preview')return send(200,await engine.issue(input));
        if(url.pathname==='/api/v1/intake/recommend')return send(200,recommendWork(input));
        if(url.pathname==='/api/v1/issues/start')return send(201,await engine.start(input));
        const cancel=url.pathname.match(/^\/api\/v1\/jobs\/(job_[a-f0-9]+)\/cancel$/);
        if(cancel)return send(200,await engine.interrupt(cancel[1],input.run_id));
        const resume=url.pathname.match(/^\/api\/v1\/jobs\/(job_[a-f0-9]+)\/resume$/);
        if(resume)return send(200,await engine.resume(resume[1]));
      }
      const asset=url.pathname.match(/^\/assets\/([\w.-]+\.(js|css|woff2))$/);
      if(request.method==='GET'&&(url.pathname==='/'||asset)) {
        const name=asset?`assets/${asset[1]}`:'index.html',path=join(ui,name),types={js:'text/javascript',css:'text/css',woff2:'font/woff2'};
        if(!existsSync(path))throw new QueueError('Asset not found',404);
        return send(200,readFileSync(path),asset?types[asset[2]]:'text/html; charset=utf-8');
      }
      throw new QueueError('Native capability unavailable',404);
    } catch(error) {send(error.status||503,{error:error.status?error.message:'Native state unavailable; inspect private server logs.'});}
  });
  server.requestTimeout=45000;server.headersTimeout=15000;
  return {server,engine};
}
