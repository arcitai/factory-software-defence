// Account quotas are native observations, never execution admission or a bill.
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim() ? value.slice(0,120) : null;
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
const date = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const epoch = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 1e11 ? new Date(value*1000).toISOString() : null;
const window = (id,label,used,resets) => ({id,label,used_percent:percent(used),resets_at:resets});
const duration = (mins,fallback) => Number.isSafeInteger(mins) && mins > 0
  ? mins%1440===0 ? `${mins/1440} days` : mins%60===0 ? `${mins/60} hours` : `${mins} minutes` : fallback;

export function codexUsage(value) {
  const buckets=plain(value?.rateLimitsByLimitId) ? Object.entries(value.rateLimitsByLimitId)
    : plain(value?.rateLimits) ? [[value.rateLimits.limitId || 'codex',value.rateLimits]] : [];
  const windows=[];let plan=null;
  for(const [id,bucket] of buckets.slice(0,16)) {
    if(!plain(bucket))continue;
    plan ||= text(bucket.planType);
    const name=text(bucket.limitName)||text(id)||'Codex';
    for(const key of ['primary','secondary']) {
      const limit=bucket[key];if(!plain(limit))continue;
      windows.push(window(`${id}:${key}`,`${name} · ${duration(limit.windowDurationMins,key==='primary'?'Primary window':'Secondary window')}`,limit.usedPercent,epoch(limit.resetsAt)));
    }
  }
  return {plan,windows,source:'Native Codex account limits'};
}

const claudeWindows={five_hour:'5 hours',seven_day:'7 days',seven_day_oauth_apps:'7 days · OAuth apps',seven_day_opus:'7 days · Opus',seven_day_sonnet:'7 days · Sonnet'};
export function claudeUsage(value) {
  const limits=value?.rate_limits_available===true && plain(value.rate_limits) ? value.rate_limits : {};
  const windows=Object.entries(claudeWindows).filter(([key])=>plain(limits[key]))
    .map(([key,label])=>window(key,label,limits[key].utilization,date(limits[key].resets_at)));
  if(Array.isArray(limits.model_scoped))for(const [index,limit] of limits.model_scoped.slice(0,16).entries()) {
    if(plain(limit)&&text(limit.display_name))windows.push(window(`model:${index}`,`7 days · ${text(limit.display_name)}`,limit.utilization,date(limit.resets_at)));
  }
  return {plan:text(value?.subscription_type),windows,source:'Native Claude /usage'};
}

export const hasUsage = value => value?.windows?.some(limit=>limit.used_percent!==null);
export function usageView(value,now,stale=false) {
  const windows=(value?.windows||[]).map(limit=>({...limit,reset_passed:Boolean(limit.resets_at&&Date.parse(limit.resets_at)<=now)}));
  return {...value,windows,status:!hasUsage(value)?'unavailable':stale||windows.some(limit=>limit.reset_passed)?'last_known':'reported'};
}

// A short cache coalesces reads from multiple tabs. Failure never fabricates zero
// or changes native permission/readiness. No persistent polling or inference.
export function usageCache({read,now=Date.now,interval=120000}) {
  let pending,lastAttempt=-Infinity,lastGood=null,lastResult=null;
  return async()=>{
    if(pending)return pending;
    if(now()-lastAttempt<interval)return usageView(lastResult,now(),lastResult?.status==='last_known');
    lastAttempt=now();
    pending=(async()=>{
      let result;
      try {result=await read();} catch {result=null;}
      const checked_at=new Date(now()).toISOString();
      if(hasUsage(result)) {
        lastGood={...result,checked_at};lastResult=usageView(lastGood,now());
      } else {
        lastResult=usageView({...lastGood,plan:result?.plan||lastGood?.plan||null,
          source:lastGood?.source||result?.source||null,checked_at:lastGood?.checked_at||null,
          attempted_at:checked_at,windows:lastGood?.windows||[],note:'The native harness did not return current limits.'},now(),true);
      }
      return lastResult;
    })();
    try{return await pending;}finally{pending=null;}
  };
}
