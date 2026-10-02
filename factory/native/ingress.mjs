import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync, unlinkSync } from 'node:fs';
import { isIP, createConnection } from 'node:net';
import { join } from 'node:path';

const invalid=()=>new Error('Private ingress configuration is invalid; preserve it and reconcile the selected installation.');
const reserved=/^(?:sec-|proxy-|content-|access-control-|if-|accept-|x-forwarded-|x-factory-)/;
const reservedHeaders=new Set(['host','origin','forwarded','connection','upgrade','authorization','cookie','set-cookie',
  'referer','user-agent','accept','accept-encoding','accept-language','cache-control','pragma','expect','te','trailer','transfer-encoding']);
export const ingressFile=state=>join(state,'ingress.json');
export const ingressSocket=state=>join(state,'inbox.sock');

export function validateIngress(value) {
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||Object.keys(value).sort().join(',')!=='identities,identity_header,origin,version'||value.version!==1)throw invalid();
  const {origin,identity_header:header,identities}=value;
  let url;
  try {url=new URL(origin);}catch {throw invalid();}
  // Canonical origins exclude credentials, paths, default-port aliases and URL
  // parser normalization. Requests must match these exact bytes, not a suffix.
  const hostname=url.hostname,ip=isIP(hostname.replace(/^\[|\]$/g,''));
  const dns=hostname.length<=253&&hostname.split('.').every(label=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  if(typeof origin!=='string'||origin.length>300||url.protocol!=='https:'||url.origin!==origin
    ||(!ip&&!dns)||url.port==='0')throw invalid();
  if(typeof header!=='string'||! /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(header)||header.length>64
    ||reserved.test(header)||reservedHeaders.has(header))throw invalid();
  if(!Array.isArray(identities)||identities.length<1||identities.length>32||new Set(identities).size!==identities.length
    ||identities.some(identity=>typeof identity!=='string'||identity.includes('*')||! /^[\x21-\x2b\x2d-\x7e]{1,256}$/.test(identity)))throw invalid();
  return Object.freeze({version:1,origin,identity_header:header,identities:Object.freeze([...identities])});
}

export function assertPrivateIngressState(state) {
  const stat=lstatSync(state);
  if(!stat.isDirectory()||stat.uid!==process.getuid()||(stat.mode&0o077))
    throw new Error('Private ingress needs an owned state directory with mode 0700.');
  if(Buffer.byteLength(ingressSocket(state))>107)throw new Error('Private ingress state path is too long for a Unix socket; choose a shorter private state path deliberately.');
}
export function readIngress(state) {
  const config=readIngressInput(ingressFile(state),{optional:true});
  if(config)assertPrivateIngressState(state);
  return config;
}
export function readIngressInput(path,{optional=false}={}) {
  let fd;
  try {fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);}
  catch(error) {if(optional&&error.code==='ENOENT')return null;throw invalid();}
  try {
    const stat=fstatSync(fd);
    if(!stat.isFile()||stat.uid!==process.getuid()||(stat.mode&0o077)||stat.nlink!==1||stat.size>16384)throw invalid();
    return validateIngress(JSON.parse(readFileSync(fd,'utf8')));
  } catch {throw invalid();}finally {closeSync(fd);}
}
export const ingressDigest=config=>config?createHash('sha256').update(JSON.stringify(config)).digest('hex'):null;
export function ingressProjection(config,live=null) {
  const digest=ingressDigest(config);
  return {configured:Boolean(config),config_sha256:digest,
    listening:typeof live?.listening==='boolean'?live.listening:null,
    matches_live:live===null?null:live?.config_sha256===digest&&live?.configured===Boolean(config),
    transport_qualification:'not established; verify TLS, proxy identity, access policy and approved/denied devices'};
}
export function assertLiveIngress(config,live) {
  // Older loopback-only releases need no migration. An opted-in installation
  // cannot adopt/roll back to a release that drops its ingress contract.
  if(!config&&live===undefined)return;
  const expected=ingressProjection(config,live);
  if(!expected.matches_live||expected.listening!==Boolean(config))
    throw new Error('Private ingress configuration and owning listener differ; qualification is unresolved.');
}
const sameSocket=(a,b)=>a?.isSocket()&&b?.isSocket()&&a.uid===b.uid&&a.dev===b.dev&&a.ino===b.ino;
function socketStat(path) {try {return lstatSync(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
export function removeOwnedIngressSocket(path,owned) {
  const current=socketStat(path);
  if(sameSocket(current,owned)&&current.uid===process.getuid())unlinkSync(path);
}
export async function prepareIngressSocket(state) {
  assertPrivateIngressState(state);
  const path=ingressSocket(state),stat=socketStat(path);
  if(!stat)return;
  if(!stat.isSocket()||stat.uid!==process.getuid()||(stat.mode&0o077))
    throw new Error('Ingress socket path is not a private owned socket; preserve it before recovery.');
  // The launcher already holds serve.lock. A responding socket or ambiguous
  // connection is still an unknown owner and must never be unlinked.
  const refused=await new Promise(resolve=>{
    const socket=createConnection(path);
    socket.setTimeout(1000,()=>{socket.destroy();resolve(false);});
    socket.once('connect',()=>{socket.destroy();resolve(false);});
    socket.once('error',error=>resolve(error.code==='ECONNREFUSED'));
  });
  if(!refused||!sameSocket(socketStat(path),stat))throw new Error('Ingress socket owner is active or unknown; reconcile it before startup.');
  removeOwnedIngressSocket(path,stat);
}
