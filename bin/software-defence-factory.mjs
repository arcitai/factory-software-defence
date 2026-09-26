#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, openSync, closeSync, rmSync, renameSync, realpathSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { ROOT, PINS, DEFAULT_STATE, configAt, save, json, run, stream, digest, api, sleep, stopContainers } from '../factory/lib.mjs';
import { assertInstalledJobImage, installCustomJobImage, installStandardJobImage, inspectImageInstallation } from '../factory/image-install.mjs';
import { listIssues, readIssue } from '../factory/issue-intake.mjs';
import { recommendWork } from '../factory/intake.mjs';
import { factoryDefinition, foundationSkill } from '../factory/definition.mjs';
import { harnessOf } from '../factory/lib.mjs';
import { admitIncident } from '../factory/incident.mjs';
import { DEFAULT_DEMO_STATE } from '../factory/paths.mjs';
import { bootstrap, registerInstallation, VERSION } from '../factory/updates.mjs';
import { hasService, manageService, serviceDefinition, withServiceOperation, isManagedLaunch } from '../factory/services.mjs';
import { runCandidateGit } from '../factory/git-environment.mjs';
import { initializeDemoRepository } from '../factory/demo-fixture.mjs';

try {
  const handled = await bootstrap(process.argv.slice(2));
  if (handled !== undefined) process.exit(handled);
} catch (error) { console.error(`Factory: ${error.message}`); process.exit(1); }

const args = process.argv.slice(2), command = args.shift() || 'help';
const positional = [], flags = {};
for (let i=0;i<args.length;i++) {
  if (args[i].startsWith('--')) {
    if (!args[i+1] || args[i+1].startsWith('--')) throw new Error(`Value required for ${args[i]}`);
    flags[args[i].slice(2)] = args[++i];
  } else positional.push(args[i]);
}
let state = resolve(flags.state || DEFAULT_STATE);
if(existsSync(state))state=realpathSync(state);
const alive = pid => { try { process.kill(pid,0); return true; } catch(error) { if(error.code === 'ESRCH')return false; throw error; } };

function init(repo, harness='codex', check='', port=7331, sourceRef='HEAD', delivery) {
  repo=realpathSync(resolve(repo));
  if (existsSync(join(state,'factory.json'))) throw new Error('Already configured; edit the private factory.json explicitly or choose another --state');
  if ([repo,state,ROOT].some(p=>/[,\n\r]/.test(p))) throw new Error('Paths cannot contain commas or line breaks');
  if (runCandidateGit(repo,'rev-parse','--show-toplevel') !== repo) throw new Error('--repo must be the Git root');
  runCandidateGit(repo,'rev-parse','HEAD');
  const presets={codex:['codex','exec','--json','--ephemeral','--sandbox','danger-full-access','-'],pi:['pi','--mode','json','--print','--no-session','--no-extensions','--skill','/factory-skills'],mock:['node','/opt/factory/mock.mjs']};
  const argv=harness==='custom'?JSON.parse(flags['command-json'] || 'null'):presets[harness];
  if (!argv) throw new Error('Select codex, pi, mock or custom with --command-json');
  if (flags.model && ['codex','pi'].includes(harness)) argv.splice(harness==='codex'?argv.length-1:argv.length,0,'--model',flags.model);
  mkdirSync(state,{recursive:true,mode:0o700});state=realpathSync(state);chmodSync(state,0o700);
  save(join(state,'factory.json'),{version:1,repo,sourceRef,harness,command:argv,check,port:Number(port),image:PINS.jobImage,network:harness==='mock'?'none':'bridge',timeoutSeconds:1800,memoryMiB:2048,model:flags.model || null,...(delivery?{delivery}:{}),
    scope:{project:'pilot',service:'app',environment:'test',owner:'operator'}});
  configAt(state);
  writeFileSync(join(state,'worker.token'),randomBytes(32).toString('hex')+'\n',{mode:0o600});
  writeFileSync(join(state,'model.env'),'# Only inference credentials belong here. Never add GitHub, deploy or cloud credentials.\n',{mode:0o600});
  registerInstallation(state);
  console.log(`Configured ${state}\nApp files were not changed. Only committed code is cloned into jobs.`);
}

async function install() {
  const config=configAt(state);
  if (!['darwin','linux'].includes(process.platform)||!['arm64','x64'].includes(process.arch)) throw new Error('Use macOS/Linux arm64/amd64, or WSL2');
  if(flags.image) {
    const selected=installCustomJobImage(state,flags.image,{version:VERSION});
    console.log(`Installed custom job image ${selected.image} from local reference ${selected.reference}. No image was downloaded or built; no model call made.`);
    return;
  }
  const installed=await installStandardJobImage(state,{version:VERSION});
  console.log(`Installed standard job image ${installed.image}. No model call made.`);
}
async function portFree(port) {
  await new Promise((ok,fail)=>{const server=createServer();server.once('error',fail);server.listen(port,'127.0.0.1',()=>server.close(ok));});
}
async function up() {
  const config=configAt(state),lock=join(state,'supervisor.json');
  registerInstallation(state);
  if(existsSync(lock)) { if(alive(json(lock).pid))throw new Error('Supervisor already running; use status');rmSync(lock); }
  assertInstalledJobImage(state,config);
  if(process.getuid()===0)throw new Error('Run the controller as a dedicated unprivileged user with Docker access');
  await portFree(config.port);
  const fd=openSync(join(state,'supervisor.log'),'a',0o600);
  const child=spawn(process.execPath,[join(ROOT,'factory/supervisor.mjs'),state],{detached:true,stdio:['ignore',fd,fd]});
  closeSync(fd);child.unref();
  for(let i=0;i<80;i++) {
    await sleep(250);
    if(!alive(child.pid))throw new Error(`Startup failed; inspect ${join(state,'supervisor.log')}`);
    try {const snapshot=await api(state,'/api/v1/status');if(snapshot.workers?.some(w=>w.connected&&Date.parse(w.last_seen_at)>Date.now()-2000)) { console.log(`Dashboard: http://127.0.0.1:${config.port}\nPrivate state: ${state}`);return; }} catch {}
  }
  throw new Error('Worker did not become ready; inspect supervisor.log');
}
async function stop() {
  const lock=join(state,'supervisor.json');
  if(existsSync(lock)) {
    const {pid}=json(lock);
    if(alive(pid)) {
      const identity=run('ps',['-p',String(pid),'-o','command=']);
      const controllerProcess=identity.includes(join(ROOT,'factory/supervisor.mjs'))||identity.includes(join(ROOT,'bin/software-defence-factory.mjs')+' serve');
      if(!controllerProcess||!identity.includes(state))throw new Error('PID identity changed; refusing to signal an unrelated process');
      process.kill(pid,'SIGTERM');
      for(let i=0;i<40&&existsSync(lock);i++)await sleep(250);
      if(existsSync(lock))throw new Error('Stop unconfirmed; inspect supervisor and do not start replacement workers');
    } else rmSync(lock);
  }
  stopContainers(state);console.log('Controller and its labelled containers stopped.');
}
async function submit(workflow,spec,sourceRef=flags['source-ref']) {
  if(Buffer.byteLength(spec)>240000)throw new Error('Task exceeds 240 KB');
  const title=workflow==='defence'?'Private incident triage':spec.split('\n').find(s=>s.trim())?.replace(/^#+\s*/, '').slice(0,100)||'Software task';
  return api(state,'/api/v1/jobs',{workflow,repository:'app',spec,title,...(sourceRef===undefined?{}:{source_ref:sourceRef})});
}
async function jobAction(action) {
  const id=positional[0];if(!/^job_[a-z0-9]+$/.test(id || ''))throw new Error('A job ID is required');
  const snapshot=await api(state,'/api/v1/status'),job=snapshot.jobs.find(j=>j.id===id);
  if(!job)throw new Error('Job not found');
  const current=job.runs.at(-1);
  if(action==='approve'&&job.state!=='awaiting_approval')throw new Error('Job is not awaiting approval');
  if(action==='retry'&&!['interrupted','failed','blocked','cancelled'].includes(job.state))throw new Error('Only a stopped attempt can be retried');
  let feedback;
  if(action==='request_changes') {
    if(!flags.file)throw new Error('revise requires --file feedback.md');
    feedback=readFileSync(resolve(flags.file),'utf8');
    if(!feedback.trim()||feedback.length>4000)throw new Error('Provide revision feedback under 4000 characters');
  }
  // The controller validates the current run and owns reconciliation atomically.
  // A CLI-side stop after a stale snapshot could terminate a newer attempt.
  await api(state,`/api/v1/jobs/${id}/${action}`,{run_id:current?.id,...(feedback===undefined?{}:{feedback}),...(flags['source-ref']===undefined?{}:{source_ref:flags['source-ref']})});
  console.log(`${action}: ${id}`);
}

async function publishJob(jobId) {
  if (!/^job_[a-f0-9]{24}$/.test(jobId || '')) throw new Error('publish requires a Factory JOB_ID');
  const snapshot=await api(state,'/api/v1/status'),job=snapshot.jobs.find(item=>item.id===jobId);
  if(!job)throw new Error('Job not found');
  const current=job.runs.at(-1);
  const receipt=await api(state,`/api/v1/jobs/${jobId}/publish`,{run_id:current?.id});
  console.log(JSON.stringify(receipt,null,2));
}

try {
  if(command==='init') {
    if(!flags.repo)throw new Error('init requires --repo /path/to/existing/git/repo');
    if(flags.harness && flags.agent && flags.harness !== flags.agent)throw new Error('--harness conflicts with legacy --agent');
    const deliveryFlags=[flags['delivery-provider'],flags['delivery-repository'],flags['delivery-target']];
    if(deliveryFlags.some(Boolean)&&deliveryFlags.some(value=>!value))throw new Error('Trusted PR delivery requires --delivery-provider github --delivery-repository URL --delivery-target main|dev');
    const delivery=deliveryFlags.every(Boolean)?{provider:flags['delivery-provider'],repository:flags['delivery-repository'],target:flags['delivery-target']}:undefined;
    init(flags.repo,flags.harness || flags.agent,flags.check,flags.port,flags['source-ref'] || 'HEAD',delivery);
  }
  else if(command==='install')await withServiceOperation('install',install);
  else if(command==='up') { if(hasService(state))await manageService('controller','start',state);else await withServiceOperation('up',up); }
  else if(command==='stop') { if(hasService(state))await manageService('controller','stop',state);else await withServiceOperation('stop',stop); }
  else if(command==='serve') {
    const managed=isManagedLaunch(state);
    if(hasService(state)&&!managed)throw new Error('This installation is managed; use service start instead of foreground serve');
    const launch=async()=>{
    if(process.getuid()===0)throw new Error('Use a dedicated unprivileged operator account');
    const lock=join(state,'supervisor.json');if(existsSync(lock)){if(alive(json(lock).pid))throw new Error('Supervisor already running');rmSync(lock);}
    assertInstalledJobImage(state,configAt(state));
    registerInstallation(state);await portFree(configAt(state).port);
    const { supervise } = await import('../factory/supervisor.mjs');await supervise(state);
    };
    if(managed)await launch();else await withServiceOperation('serve',launch);
  }
  else if(command==='service') {
    if(!positional.length || positional[0]==='print')console.log(serviceDefinition(state));
    else await manageService('controller',positional[0],state,flags);
  }
  else if(command==='tunnel')await manageService('tunnel',positional[0],state,flags);
  else if(command==='foundation')console.log(foundationSkill().content);
  else if(['definition','workflows','agents','skills'].includes(command)) {
    const definition=factoryDefinition(configAt(state));
    const value=command==='agents'?definition.agents:command==='skills'?{agents:definition.skills,operators:definition.operator_skills}:definition;
    console.log(JSON.stringify(value,null,2));
  }
  else if(['infrastructure','automations','inbox'].includes(command)) {
    const snapshot=await api(state,'/api/v1/status');
    console.log(JSON.stringify(command==='inbox'?snapshot.jobs:command==='automations'?snapshot.automation_control:snapshot[command],null,2));
  }
  else if(command==='status') { const snapshot=await api(state,'/api/v1/status');delete snapshot.csrf_token;console.log(JSON.stringify(snapshot,null,2)); }
  else if(command==='doctor') {
    const config=configAt(state),dockerVersion=run('docker',['info','--format','{{.ServerVersion}}']),imageStatus=inspectImageInstallation(state,config);
    console.log(JSON.stringify({node:process.version,docker:dockerVersion,engineInstalled:imageStatus.installed,image:imageStatus.image,repo:config.repo,harness:harnessOf(config),agent:harnessOf(config),checksConfigured:!!config.check?.trim(),inference:'Not called or verified',qualification:{model:'not assessed',toolchain:'not assessed'},dashboard:`http://127.0.0.1:${config.port}`},null,2));
    if(!imageStatus.installed)process.exitCode=1;
  } else if(command==='issue') {
    const action=positional[0], sourceURL=flags.url || flags.github;
    if(action==='list') {
      if(flags.source && !['factory','remote','github'].includes(flags.source))throw new Error('Choose --source factory or remote');
      console.log(JSON.stringify(['github','remote'].includes(flags.source) ? await api(state,`/api/v1/issues?page=${encodeURIComponent(flags.page || 1)}`) : (await api(state,'/api/v1/status')).jobs,null,2));
    } else if(action==='templates') console.log(JSON.stringify(await api(state,'/api/v1/issue-templates'),null,2));
    else if(action==='connection') console.log(JSON.stringify(await api(state,'/api/v1/issue-connection'),null,2));
    else if(action==='submissions') console.log(JSON.stringify(await api(state,'/api/v1/issue-submissions'),null,2));
    else if(action==='recover') {
      if(!/^[A-Za-z0-9_-]{16,100}$/.test(flags.key || ''))throw new Error('Use --key with the saved request ID');
      console.log(JSON.stringify(await api(state,`/api/v1/issue-submissions/${flags.key}/recover`,{}),null,2));
    }
    else if(action==='preview') {
      if(!sourceURL)throw new Error('Use --url ISSUE_URL');
      console.log(JSON.stringify(await api(state,'/api/v1/issues/preview',{url:sourceURL}),null,2));
    } else if(action==='recommend') {
      if(Boolean(sourceURL)===Boolean(flags.file))throw new Error('Choose --file brief.md or --url ISSUE_URL');
      console.log(JSON.stringify(sourceURL ? (await api(state,'/api/v1/issues/preview',{url:sourceURL})).recommendation : recommendWork({spec:readFileSync(resolve(flags.file),'utf8')}),null,2));
    } else if(action==='draft') {
      if(!flags.file||!flags.template||!flags.sha)throw new Error('Use --template NAME --sha SHA --file answers.json with {title, answers}');
      console.log(JSON.stringify(await api(state,'/api/v1/issue-templates/draft',{...json(resolve(flags.file)),template:flags.template,sha:flags.sha}),null,2));
    } else if(action==='create') {
      if(flags.workflow||sourceURL)throw new Error('issue create publishes a new repository issue. Use issue start for execution.');
      if(!flags.key)throw new Error('Provide a stable --key for safe retry and recovery.');
      if(Boolean(flags.draft)===Boolean(flags.file))throw new Error('Choose --draft draft.json or --file brief.md --title TITLE');
      const draft=flags.draft ? json(resolve(flags.draft)) : {title:flags.title,spec:readFileSync(resolve(flags.file),'utf8'),labels:[]};
      const connection=await api(state,'/api/v1/issue-connection');
      if(!connection.supported)throw new Error('No issue provider is available. Use issue start for a local brief.');
      console.log(JSON.stringify(await api(state,'/api/v1/issues',{title:flags.title || draft.title,spec:draft.spec,labels:draft.labels || [],request_id:flags.key,repository:connection.repository,actor:connection.actor}),null,2));
    } else if(action==='start') {
      if(!['software','defence'].includes(flags.workflow))throw new Error('Review the issue and choose --workflow software or defence');
      if([flags.file,sourceURL,flags.draft].filter(Boolean).length!==1)throw new Error('Choose --file brief.md, --draft draft.json or --url ISSUE_URL');
      let input;
      if(sourceURL) { const issue=await api(state,'/api/v1/issues/preview',{url:sourceURL});input={title:issue.title,spec:issue.spec,source_url:issue.url}; }
      else if(flags.draft) { const draft=json(resolve(flags.draft));input={title:draft.title,spec:draft.spec}; }
      else input={title:flags.title,spec:readFileSync(resolve(flags.file),'utf8')};
      input.title=flags.title || input.title;
      if(typeof input.title!=='string'||!input.title.trim()||input.title.length>160)throw new Error('Provide a title of 1–160 characters (use --title for a blank issue)');
      if(flags.workflow==='software'&&!configAt(state).check?.trim())throw new Error('Configure an app check before submitting software work');
      console.log(JSON.stringify(await api(state,'/api/v1/jobs',{...input,workflow:flags.workflow,repository:'app',model:flags.model || '',...(flags['source-ref']===undefined?{}:{source_ref:flags['source-ref']})}),null,2));
    } else throw new Error('Use issue list|connection|templates|preview|recommend|draft|create|start|submissions|recover; see help');
  } else if(command==='issues') {
    console.log(JSON.stringify(await listIssues(configAt(state).repo,Number(flags.page || 1)),null,2));
  } else if(command==='recommend') {
    if(Boolean(flags.issue) === Boolean(flags.file))throw new Error('Choose --file task.md or --issue URL');
    const recommendation=flags.issue ? (await readIssue(configAt(state).repo,flags.issue)).recommendation : recommendWork({spec:readFileSync(resolve(flags.file),'utf8')});
    console.log(JSON.stringify(recommendation,null,2));
  } else if(command==='run') {
    const workflow=flags.workflow || 'software';
    if(!['software','defence'].includes(workflow))throw new Error('Choose --workflow software or defence');
    let spec;
    if(flags.issue) {
      spec=(await readIssue(configAt(state).repo,flags.issue)).spec;
    } else if(flags.file)spec=readFileSync(resolve(flags.file),'utf8');
    else throw new Error('Use --file task.md or --issue https://github.com/owner/repo/issues/123');
    if(workflow==='software'&&!configAt(state).check?.trim())throw new Error('Configure an app check before submitting software work');
    console.log(JSON.stringify(await submit(workflow,spec)));
  } else if(command==='incident') {
    if(!flags.file)throw new Error('Use --file incident.json; see factory/examples/incident.json');
    console.log(JSON.stringify(await admitIncident(state,json(resolve(flags.file)),submit)));
  } else if(['approve','cancel','retry'].includes(command))await jobAction(command);
  else if(command==='publish')await publishJob(positional[0]);
  else if(command==='revise')await jobAction('request_changes');
  else if(command==='demo') {
    state=resolve(flags.state || DEFAULT_DEMO_STATE);
    const repo=join(state,'sample-app');
    if(!existsSync(join(state,'factory.json'))) {
      initializeDemoRepository(repo);
      init(repo,'mock',"test \"$(cat value.txt)\" = fixed",Number(flags.port || 7332));
    } else if(harnessOf(configAt(state))!=='mock')throw new Error('Demo requires a mock configuration');
    await withServiceOperation('demo startup',async()=>{await install();await up();});console.log(JSON.stringify(await submit('software','Synthetic installation qualification: fix value.txt. No inference is used.')));
    console.log('Review the synthetic change in the dashboard and approve its handoff.');
  } else if(['version','--version','-v'].includes(command))console.log(VERSION);
  else if(command==='qualify') {
    await stream(process.execPath,[join(ROOT,'scripts/probe-platform.mjs'),state]);
  } else if(command==='kit') {
    if(!flags.output)throw new Error('kit requires --output NEW_DIRECTORY');
    await stream(process.execPath,[join(ROOT,'scripts/export-kit.mjs'),resolve(flags.output)]);
  } else if(['help','--help','-h'].includes(command))console.log(`Software & Defence Factory ${VERSION} (test release)

  kit --output NEW_DIRECTORY               Export the portable method without a runtime
  demo                                    Install and run a synthetic sample (no model key)
  qualify --state PATH                    Exercise recovery and isolation with a stopped demo job
  init --repo PATH --harness codex|pi|custom --check "npm ci && npm test" [--source-ref REF]
       [--delivery-provider github --delivery-repository https://github.com/OWNER/REPO --delivery-target main|dev]
  install [--image LOCAL_REF]             Build the standard image, or select an existing local image
  doctor | up | status | stop              Inspect / operate your private installation
  foundation                              Read the operator setup skill; no installation required
  definition | agents | skills            Inspect roles, instructions and installation settings
  inbox | infrastructure | automations    Inspect live tasks, host/worker and automation state
  workflows                               Compatibility alias for definition
  --agent                                 Legacy alias for init --harness
  serve                                   Foreground supervisor
  service [print]                         Print a systemd user-service definition
  service install|start|stop|restart       Manage a Linux user service (--state PATH)
                                          install accepts --group EXISTING_GROUP
  service status|logs|uninstall            Diagnose / remove service, preserve private state
  service update                          Update idle managed controllers, restore on failure
  service updates --auto on|off|status     Daily idle updates through a systemd timer
  service resume                          Release a reconciled maintenance reservation
  tunnel install|start|stop|status|logs|uninstall --host SSH_ALIAS --port PORT
                                          Persistent loopback SSH tunnel (macOS/Linux)
  issue list [--source remote] [--page N]  List local executions or open repository issues
  issue templates                         Read this repository's issue forms and contact links
  issue preview --url URL              Preview one repository issue without starting work
  issue recommend --file brief.md | --url URL
  issue draft --template NAME --sha SHA --file answers.json
                                          Validate {title,answers}; output a local draft JSON
  issue create --draft draft.json | --file brief.md --title TITLE --key REQUEST_ID
                                          Create a repository issue; does not execute work
  issue connection | submissions          Inspect provider identity or durable creation receipts
  issue recover --key REQUEST_ID           Reconcile an uncertain creation without another write
  issue start --draft draft.json | --url URL | --file brief.md --title TITLE
               --workflow software|defence [--source-ref REF] [--model MODEL]
                                          Create a local issue and start work; no GitHub write
  issues [--page N]                       Browse open project issues, with next_page for more
  recommend --file task.md | --issue URL  Suggest a work type without starting work
  run --file task.md | --issue URL         Submit software (default), or --workflow defence
       [--source-ref REF]                 Pin a configured-repository ref before admission
  incident --file incident.json            Submit a private, read-only incident draft
  approve JOB_ID | cancel JOB_ID           Review gate / stop this attempt
  publish JOB_ID                          Publish/reconcile the accepted candidate as one draft PR
  retry JOB_ID                            Prove stop; retain old checkout and retry
  revise JOB_ID --file feedback.md [--source-ref REF]
                                          New build/check/review; source stays pinned unless a new ref is explicit
  version                                 Show the active CLI version
  update | update --check                 Update the npm CLI / inspect the latest release
  update --auto on|off                    Control automatic daily CLI updates

Runtime commands accept --state PATH. Default: ${DEFAULT_STATE}
Demo default: ${DEFAULT_DEMO_STATE}
The npm CLI keeps state outside the package; updates wait for stopped installations.
Dashboard binds only to loopback; use SSH for remote access.
  Setup plan: ${join(ROOT, 'docs/setup.md')}
See docs/quickstart.md for task execution, evidence and recovery.`);
  else throw new Error(`Unknown command: ${command}`);
} catch(error) {console.error(`Factory: ${error.message}`);process.exitCode=1;}
