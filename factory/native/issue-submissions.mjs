import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueueError } from '../error.mjs';

const validKey=/^[A-Za-z0-9_-]{16,100}$/;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export class NativeIssueSubmissions {
  constructor(state,provider) {this.folder=join(state,'issue-submissions');this.provider=provider;this.active=new Set();}
  path(key) {if(!validKey.test(key||''))throw new QueueError('Provide a stable request key of 16–100 letters, digits, hyphens or underscores.',400);return join(this.folder,`${key}.json`);}
  get(key) {try{return JSON.parse(readFileSync(this.path(key),'utf8'));}catch(error){if(error.code==='ENOENT')return null;throw error;}}
  present(record) {return {request_id:record.request_id,state:record.state,provider:record.provider,repository:record.repository,actor:record.actor,title:record.payload.title,created_at:record.created_at,issue:record.issue||null,error:record.error||null};}
  list() {return readdirSync(this.folder).filter(name=>validKey.test(name.slice(0,-5))&&name.endsWith('.json')).map(name=>JSON.parse(readFileSync(join(this.folder,name),'utf8'))).sort((a,b)=>b.created_at.localeCompare(a.created_at)).slice(0,50).map(record=>this.present(record));}
  save(record,newFile=false) {const path=this.path(record.request_id),value=`${JSON.stringify(record)}\n`;if(newFile)writeFileSync(path,value,{flag:'wx',mode:0o600});else {const tmp=`${path}.${randomUUID()}`;writeFileSync(tmp,value,{flag:'wx',mode:0o600});renameSync(tmp,path);}return this.present(record);}
  async exclusive(key,fn) {if(this.active.has(key))throw new QueueError('Issue submission is already changing.',409);this.active.add(key);try{return await fn();}finally{this.active.delete(key);}}
  create(input) {return this.exclusive(input.request_id,()=>this.publish(input));}
  async publish(input) {
    const existing=this.get(input.request_id);
    if(typeof input.title!=='string'||!input.title.trim()||input.title.length>160||typeof input.spec!=='string'||!input.spec.trim()||Buffer.byteLength(input.spec)>60000)throw new QueueError('Provide a title under 161 characters and a description under 60 KB.',400);
    if(!Array.isArray(input.labels)||input.labels.length>50||input.labels.some(label=>typeof label!=='string'||!label.trim()||label.length>100))throw new QueueError('Provide up to 50 valid issue labels.',400);
    const payload={title:input.title.trim(),body:input.spec.trim(),labels:[...new Set(input.labels)].sort()};
    const context=await this.provider.context();
    if(input.repository!==context.repository||input.actor!==context.actor)throw new QueueError('Repository destination or identity changed. Review the connection before creating.',409);
    const fingerprint=hash({provider:this.provider.id,repository:context.repository,actor_id:context.actor_id,payload});
    if(existing) {if(existing.hash!==fingerprint)throw new QueueError('This request key already belongs to different content or identity.',409);if(existing.state==='created')return this.present(existing);if(existing.state!=='rejected')return this.reconcile(existing);}
    if(!context.available)throw new QueueError('This repository is archived or has issues disabled.',400);
    if(payload.labels.length&&!context.labels_supported)throw new QueueError('This identity cannot apply the selected labels.',403);
    const record=existing||{request_id:input.request_id,provider:this.provider.id,hash:fingerprint,repository:context.repository,actor:context.actor,actor_id:context.actor_id,payload,correlation_id:randomUUID(),created_at:new Date().toISOString()};
    record.state='pending';record.error=null;this.save(record,!existing);
    try {record.issue=await this.provider.publish(record);record.state='created';return this.save(record);}
    catch(error) {record.state=[400,401,403,404,410,422,429].includes(error.httpStatus)?'rejected':'uncertain';record.error=record.state==='rejected'?'Repository provider rejected issue creation.':'Creation may have succeeded; reconcile this receipt before trying again.';this.save(record);throw new QueueError(`${record.error} Request: ${record.request_id}`,409);}
  }
  recover(key) {return this.exclusive(key,async()=>{const record=this.get(key);if(!record)throw new QueueError('Submission not found.',404);const context=await this.provider.context();if(record.provider!==this.provider.id||record.repository!==context.repository||record.actor_id!==context.actor_id)throw new QueueError('Restore the original repository and provider identity before recovery.',409);if(record.state==='created'||record.state==='rejected')return this.present(record);return this.reconcile(record);});}
  async reconcile(record) {const issue=await this.provider.recover(record);record.issue=issue;record.state='created';record.error=null;return this.save(record);}
}
