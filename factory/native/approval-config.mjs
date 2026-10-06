import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { AppServer, nativeReadiness } from './app-server.mjs';
import { codexApprovals } from './codex-approvals.mjs';
import { NativeEngine } from './engine.mjs';
import { acquireProcessLock } from './process-lock.mjs';
import { readNative } from './setup.mjs';
import { atomicallyWrite, hash, withWriterGate } from './writer.mjs';

function writeProfile(path,text) {
  const temp=`${path}.${randomBytes(8).toString('hex')}`;
  writeFileSync(temp,text,{flag:'wx',mode:0o600});renameSync(temp,path);
}
export async function changeCodexApprovals(state,mode) {
  const selection=codexApprovals({approvals:mode}),native=readNative(state);
  if(native.config.harness)throw new Error('Approval mode selection applies only to Codex.');
  const release=acquireProcessLock(join(native.state,'serve.lock'),'Approval configuration; stop the Factory service first');
  let client;
  try {
    return await withWriterGate(native.config,async()=>{
      client=await new AppServer(native).connect();
      const engine=new NativeEngine(native.state,native.config,client,null);
      await engine.assertWorkspaceIdle();
      if((native.config.approvals||'never')===mode)return {changed:false,approvals:mode};
      const path=join(native.state,'home','.codex','config.toml'),before=readFileSync(path,'utf8');
      if(hash(before)!==native.config.config_sha256)throw new Error('Native configuration changed; no approval settings were written.');
      // Only top-level approval fields change. Filesystem, network, model and
      // native login remain byte-for-byte the existing selected configuration.
      const section=before.search(/^\[/m),top=section<0?before:before.slice(0,section),rest=section<0?'':before.slice(section);
      const nextTop=top.replace(/^approval_policy\s*=.*\n/m,`approval_policy = ${JSON.stringify(selection.approvalPolicy)}\n`)
        .replace(/^approvals_reviewer\s*=.*\n/m,'');
      if(!/^approval_policy\s*=/m.test(nextTop))throw new Error('Pinned approval policy is unavailable.');
      const next=nextTop+`approvals_reviewer = ${JSON.stringify(selection.approvalsReviewer)}\n`+rest;
      const config={...native.config,approvals:mode,config_sha256:hash(next)};
      const backups=join(native.state,'approval-backups');mkdirSync(backups,{recursive:true,mode:0o700});
      const backup=join(backups,`${Date.now()}-${randomBytes(4).toString('hex')}.json`);
      atomicallyWrite(backup,{config:native.config,toml:before});
      client.close();client=null;
      try {
        writeProfile(path,next);atomicallyWrite(join(native.state,'native.json'),config);
        client=await new AppServer(readNative(native.state)).connect();
        const readiness=await nativeReadiness(client,config,native.state);
        if(!readiness.ready)throw new Error(`Native approval configuration rejected: ${readiness.gaps.join('; ')}`);
        return {changed:true,approvals:mode,backup,readiness,qualification:'Effective configuration checked; installed execution proof is separate.'};
      } catch(error) {
        client?.close();client=null;
        writeProfile(path,before);atomicallyWrite(join(native.state,'native.json'),native.config);
        throw new Error(`${error.message} Previous pinned configuration restored; no native turn was started.`);
      }
    });
  } finally {client?.close();release();}
}
