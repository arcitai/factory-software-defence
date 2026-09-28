export const statusGroups=[
  {id:'not_started',label:'Not started',count:'notStarted',tone:'neutral',states:['not_started']},
  {id:'in_progress',label:'In progress',count:'running',tone:'violet',states:['running'],children:[['running','Running','running']]},
  {id:'needs_attention',label:'Needs attention',count:'needsAttention',tone:'amber',states:['failed','interrupted','unknown'],children:[['failed','Failed','failed'],['interrupted','Interrupted','interrupted'],['unknown','Unknown','unknown']]},
  {id:'needs_review',label:'Needs review',count:'needsReview',tone:'amber',states:['needs_review']},
];
export const boardColumns=statusGroups.map(group=>({...group,title:group.label}));
const known=new Set(statusGroups.flatMap(group=>group.states));
export const boardColumnForState=state=>statusGroups.find(group=>group.states.includes(state))?.id||'needs_attention';
export function filterJobs(jobs,filter) {
  if(Array.isArray(filter))return filter.length?jobs.filter(job=>filter.includes(job.state)):jobs;
  if(filter==='all')return jobs;
  if(filter==='needs_attention')return jobs.filter(job=>['failed','interrupted','unknown'].includes(job.state));
  return jobs.filter(job=>job.state===filter);
}
export function searchJobs(jobs,query) {
  const needle=String(query||'').trim().toLocaleLowerCase();if(!needle)return jobs;
  return jobs.filter(job=>[jobDisplayTitle(job),job.state,job.workflow?.name,job.task?.source_url,
    job.work?.identity?.number,...(job.work?.issue?.labels||[]).map(label=>label.name),
    ...(job.work?.executions||[]).map(item=>`${item.id} ${item.workflow} ${item.state}`)].some(value=>String(value||'').toLocaleLowerCase().includes(needle)));
}
export function groupJobsByBoardColumn(jobs) {
  const groups=Object.fromEntries(statusGroups.map(group=>[group.id,[]]));
  for(const job of jobs)groups[boardColumnForState(job.state)].push(job);
  return groups;
}
export function jobCounts(jobs) {
  return {all:jobs.length,notStarted:jobs.filter(job=>job.state==='not_started').length,
    running:jobs.filter(job=>job.state==='running').length,
    needsAttention:jobs.filter(job=>['failed','interrupted','unknown'].includes(job.state)).length,
    failed:jobs.filter(job=>job.state==='failed').length,
    interrupted:jobs.filter(job=>job.state==='interrupted').length,
    unknown:jobs.filter(job=>job.state==='unknown').length,
    needsReview:jobs.filter(job=>job.state==='needs_review').length,
    other:jobs.filter(job=>!known.has(job.state)).length};
}
export const currentRun=job=>job.runs?.at(-1);
export function taskPhase(job) {return currentRun(job)?.command||'';}
export function nextOperatorAction(job) {
  return ({not_started:'Open issue context to start work',running:'Codex work in progress',needs_review:'Check changes and arrange independent review',failed:'Inspect failure and continue explicitly',interrupted:'Inspect native history before continuing',unknown:'Inspect native history; state is unresolved'})[job.state]||'Inspect native history';
}
export function jobsByRecentActivity(jobs) {
  const activity=job=>Date.parse(job.updated_at)||Date.parse(job.created_at)||0;
  return [...jobs].sort((a,b)=>activity(b)-activity(a));
}
export function jobDisplayTitle(job) {return job.task?.title||job.github_issue_title||job.task?.source_url||job.id;}
export function githubIssueReference(job) {const match=job.task?.source_url?.match(/\/issues\/(\d+)\/?$/);return match?`#${match[1]}`:'';}
