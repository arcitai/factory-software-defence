import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,mkdirSync,readFileSync,rmSync,writeFileSync,statSync,realpathSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { codexUsage,claudeUsage,usageCache } from '../factory/native/usage.mjs';
import { createUsageReader,linkUsage } from '../factory/native/usage-sources.mjs';

test('Codex keeps independent named buckets, provider durations and unknown fields',()=>{
  const value=codexUsage({accountId:'private-account',rateLimits:{primary:{usedPercent:99}},rateLimitsByLimitId:{
    codex:{planType:'pro',primary:{usedPercent:32,windowDurationMins:10080,resetsAt:1791580526}},
    custom:{limitName:'Code review',secondary:{usedPercent:0,windowDurationMins:null,resetsAt:null}},
    malformed:{primary:{usedPercent:'0',windowDurationMins:300,resetsAt:'tomorrow'}}}});
  assert.equal(value.windows.length,3);
  assert.deepEqual(value.windows[0],{id:'codex:primary',label:'codex · 7 days',used_percent:32,resets_at:'2026-10-09T21:15:26.000Z'});
  assert.equal(value.windows[1].used_percent,0);assert.equal(value.windows[1].resets_at,null);
  assert.equal(value.windows[2].used_percent,null);
  assert.equal(JSON.stringify(value).includes('private-account'),false);
  assert.equal(codexUsage({rateLimitsByLimitId:{},rateLimits:{primary:{usedPercent:99}}}).windows.length,0,'present empty map does not revive legacy values');
  assert.equal(codexUsage({rateLimits:{primary:{usedPercent:101}}}).windows[0].used_percent,null);
});
test('Claude /usage percentages are not streaming fractions or API-equivalent session costs',()=>{
  const value=claudeUsage({subscription_type:'pro',rate_limits_available:true,session:{total_cost_usd:99},rate_limits:{
    five_hour:{utilization:63,resets_at:'2026-10-06T14:00:00Z'},seven_day:{utilization:5,resets_at:null},
    seven_day_sonnet:{utilization:null},model_scoped:[{display_name:'Native model bucket',utilization:12,resets_at:null}],
    extra_usage:{used_credits:500}}});
  assert.deepEqual(value.windows.map(limit=>limit.used_percent),[63,5,null,12]);
  assert.equal(value.windows[3].label,'7 days · Native model bucket');
  assert.equal(value.cost,undefined);
  assert.deepEqual(claudeUsage({rate_limits_available:true,rate_limits:null}).windows,[]);
  assert.deepEqual(claudeUsage({rate_limits_available:false,rate_limits:{five_hour:{utilization:10}}}).windows,[]);
});
test('quota reads coalesce, retain failure age, never reset a past window to zero and recover',async()=>{
  let now=1791288000000,reads=0,finish,fail=false;
  const pending=new Promise(resolve=>{finish=resolve;});
  const read=usageCache({now:()=>now,interval:120000,read:async()=>{reads++;if(reads===1)await pending;if(fail)throw Error('private failure');return claudeUsage({rate_limits_available:true,rate_limits:{five_hour:{utilization:82,resets_at:new Date(now+60000).toISOString()}}});}});
  const a=read(),b=read();finish();const first=await a;await b;
  assert.equal(reads,1);assert.equal(first.status,'reported');
  now+=61000;const expired=await read();assert.equal(expired.status,'last_known');assert.equal(expired.windows[0].used_percent,82);assert.equal(reads,1);
  now+=60000;fail=true;const failed=await read();assert.equal(failed.checked_at,first.checked_at);assert.equal(failed.status,'last_known');assert.equal(JSON.stringify(failed).includes('private failure'),false);
  now+=120000;fail=false;assert.equal((await read()).status,'reported');
  const unavailable=await usageCache({read:async()=>{throw Error('no login');}})();assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.checked_at,null);assert.deepEqual(unavailable.windows,[]);
});
test('usage links are explicit, deduplicate profiles, survive a missing source and never change executor state',async t=>{
  const root=realpathSync(mkdtempSync(join(tmpdir(),'factory-usage-')));t.after(()=>rmSync(root,{recursive:true,force:true}));
  const owner=join(root,'owner'),target=join(root,'target'),duplicate=join(root,'duplicate');for(const p of [owner,target,duplicate])mkdirSync(p,{mode:0o700});
  const configs=new Map([[owner,{state:owner,config:{repo:'/one'},env:{CODEX_HOME:'/private/codex'}}],[target,{state:target,config:{harness:'claude',config_dir:'/private/claude',repo:'/two'}}],[duplicate,{state:duplicate,config:{harness:'claude',config_dir:'/private/claude',repo:'/three'}}]]);
  const load=state=>{const value=configs.get(state);if(!value)throw Error('Missing native source');return value;};
  assert.equal(linkUsage(owner,target,false,{load}).status,'linked');
  assert.equal(linkUsage(owner,duplicate,false,{load}).status,'already_linked');
  assert.equal(statSync(join(owner,'usage-links.json')).mode&0o777,0o600);
  assert.equal(JSON.parse(readFileSync(join(owner,'usage-links.json'))).sources.length,1);
  const reader=createUsageReader(owner,{load,read:async native=>native.config.harness==='claude'?claudeUsage({subscription_type:'pro',rate_limits_available:true,rate_limits:null}):codexUsage({rateLimits:{primary:{usedPercent:12}}})});
  const result=await reader();assert.equal(result.profiles.length,2);assert.equal(result.profiles[0].windows[0].used_percent,12);assert.equal(result.profiles[1].status,'unavailable');
  assert.equal(JSON.stringify(result).includes('/private/'),false);
  assert.equal(configs.get(owner).config.harness,undefined);
  configs.delete(target);rmSync(target,{recursive:true});
  assert.equal(linkUsage(owner,target,true,{load}).status,'unlinked');assert.equal((await reader()).profiles.length,1);
  writeFileSync(join(owner,'usage-links.json'),'{broken',{mode:0o600});await assert.rejects(reader,/unreadable/);
});
