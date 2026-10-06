export function routeFromHash(hash) {
  const value=String(hash||'').replace(/^#\//,'');
  if(value==='analytics')return {view:'analytics',jobID:'',issueKey:''};
  if(value.startsWith('issues/')) {
    try {return {view:'issue',issueKey:decodeURIComponent(value.slice(7)),jobID:''};}
    catch {return {view:'runs',issueKey:'',jobID:''};}
  }
  const detail=value.match(/^(?:runs|inbox)\/(.+)$/);
  if(detail) {
    try {return {view:'task',jobID:decodeURIComponent(detail[1]),issueKey:''};}
    catch {return {view:'runs',issueKey:'',jobID:''};}
  }
  return {view:'runs',jobID:'',issueKey:''};
}
