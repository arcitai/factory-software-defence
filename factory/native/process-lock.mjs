import { closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, rmSync, writeSync } from 'node:fs';
import { dirname } from 'node:path';

function identity(pid=process.pid) {
  if (process.platform!=='linux') throw new Error('Native process identity checks currently require Linux.');
  const boot_id=readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim();
  const fd=openSync(`/proc/${pid}/stat`,'r'),buffer=Buffer.alloc(8192);
  let count;
  try {count=readSync(fd,buffer,0,buffer.length,0);} finally {closeSync(fd);}
  const stat=buffer.subarray(0,count).toString('utf8'),tail=stat.slice(stat.lastIndexOf(')')+2).trim().split(/\s+/);
  const start_time=tail[19];
  if (!/^\d+$/.test(start_time||'')) throw new Error('Cannot verify the native process identity.');
  return {pid,boot_id,start_time};
}
function same(a,b) {return a?.pid===b.pid && a?.boot_id===b.boot_id && a?.start_time===b.start_time;}
function alive(owner) {
  if (!owner || !Number.isSafeInteger(owner.pid) || typeof owner.boot_id!=='string' || typeof owner.start_time!=='string') return null;
  try {
    const current=identity(owner.pid);
    return current.boot_id===owner.boot_id && current.start_time===owner.start_time;
  } catch(error) {
    if (error.code==='ENOENT' || error.code==='ESRCH') return false;
    if (error.code==='EACCES' || error.code==='EPERM') return null;
    try {return readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim()!==owner.boot_id ? false : null;}
    catch {return null;}
  }
}
export function inspectProcessLock(path) {
  if(!existsSync(path))return 'absent';
  try {
    const stat=lstatSync(path);
    if(!stat.isFile())return 'unknown';
    const current=alive(JSON.parse(readFileSync(path,'utf8')));
    return current===true?'active':current===false?'stale':'unknown';
  } catch {return 'unknown';}
}
export function activeProcessLock(path) {
  try {
    const stat=lstatSync(path);
    if(!stat.isFile())return null;
    const owner=JSON.parse(readFileSync(path,'utf8'));
    return alive(owner)===true?owner:null;
  } catch {return null;}
}
export function acquireProcessLock(path,purpose='Factory service') {
  const owner=identity(),payload={...owner,purpose};
  mkdirSync(dirname(path),{recursive:true,mode:0o700});
  const gate=`${path}.reconcile`;
  try {mkdirSync(gate,{mode:0o700});}
  catch(error) {
    if(error.code==='EEXIST')throw new Error(`${purpose} lock reconciliation is in progress or unresolved; inspect it before restarting.`);
    throw error;
  }
  try {
    if(existsSync(path)) {
      let previous;
      try {previous=JSON.parse(readFileSync(path,'utf8'));}
      catch {throw new Error(`${purpose} lock is unreadable; preserve it and reconcile the service process.`);}
      if(alive(previous)!==false)throw new Error(`${purpose} is already running or its owner cannot be verified (PID ${previous.pid ?? 'unknown'}).`);
      rmSync(path);
    }
    const fd=openSync(path,'wx',0o600);
    try {writeSync(fd,`${JSON.stringify(payload)}\n`);} finally {closeSync(fd);}
    return ()=>{
      try {if(same(JSON.parse(readFileSync(path,'utf8')),owner))rmSync(path);} catch {}
    };
  } finally {rmSync(gate,{recursive:true});}
}
