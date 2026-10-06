import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicallyWrite } from './writer.mjs';
import { claudeEventUsage } from './usage.mjs';

const location=config=>join(config.config_dir,'factory-usage.json');
// A single sanitized observation in the already-selected private profile.
// It has no session content, credential or execution/admission authority.
export function readClaudeObservation(config,now=Date.now()) {
  try {
    const path=location(config),info=lstatSync(path);
    if(!info.isFile()||info.mode&0o077||info.size>16000)return null;
    const value=JSON.parse(readFileSync(path,'utf8'));
    if(value.version!==1||!Number.isFinite(value.observed_at)||value.observed_at>now||now-value.observed_at>3600000)return null;
    return claudeEventUsage({type:'rate_limit_event',rate_limit_info:{unifiedWindows:value.windows}},value.observed_at);
  }catch{return null;}
}
export function recordClaudeObservation(config,message,now=Date.now()) {
  const value=claudeEventUsage(message,now);if(!value)return false;
  const windows=Object.fromEntries(value.windows.map(limit=>[limit.id,{utilization:limit.used_percent/100,resetsAt:limit.resets_at?Date.parse(limit.resets_at)/1000:null}]));
  try {atomicallyWrite(location(config),{version:1,observed_at:now,windows});return true;}
  catch{return false;} // Optional telemetry cannot fail or replay native work.
}
