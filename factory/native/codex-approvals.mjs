// Codex owns review and authorization. This module selects its native mode and
// projects bounded live observations; it never grants or retries an action.
export function codexApprovals(config) {
  const mode=config.approvals ?? 'never';
  if (!['never','auto-review'].includes(mode)) throw new Error('Unsupported Codex approval mode. Choose never or auto-review.');
  return {approvalPolicy:mode==='auto-review'?'on-request':'never',approvalsReviewer:mode==='auto-review'?'auto_review':'user'};
}
export function confirmedApprovals(value,config) {
  const expected=codexApprovals(config);
  return value?.approvalPolicy===expected.approvalPolicy
    && (value.approvalsReviewer===expected.approvalsReviewer
      || (expected.approvalPolicy==='never' && value.approvalsReviewer===undefined));
}
const identity=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(value);
const statuses=new Set(['inProgress','approved','denied','timedOut','aborted']);
const reasons={inProgress:'Codex is reviewing this action.',approved:'Codex approved this action. Execution and project acceptance are separate.',
  denied:'Codex declined this action. Inspect the native session for its reason.',
  timedOut:'The native review timed out. No approval is confirmed.',aborted:'The native review was interrupted. No approval is confirmed.',
  unknown:'The review outcome is unknown. Inspect the native session before acting.'};

export class ApprovalObservations {
  constructor(){this.reviews=new Map();}
  observe(method,params) {
    if (!['item/autoApprovalReview/started','item/autoApprovalReview/completed'].includes(method)) return;
    const p=params;
    if (!identity(p?.threadId)||!identity(p.turnId)||!identity(p.reviewId)||!statuses.has(p.review?.status)) return;
    const completed=method.endsWith('/completed');
    if (completed === (p.review.status==='inProgress') || (completed&&p.decisionSource!=='agent')) return;
    const key=`${p.threadId}:${p.turnId}:${p.reviewId}`,prior=this.reviews.get(key);
    // A delayed start cannot undo a terminal native observation.
    if(prior&&prior.status!=='inProgress')return;
    this.reviews.set(key,{thread_id:p.threadId,turn_id:p.turnId,review_id:p.reviewId,
      item_id:identity(p.targetItemId)?p.targetItemId:null,status:p.review.status,
      observed_at:new Date().toISOString()});
    while(this.reviews.size>200)this.reviews.delete(this.reviews.keys().next().value);
  }
  snapshot(threadId,turnId,available,nativeStatus) {
    const reviews=[...this.reviews.values()].filter(r=>r.thread_id===threadId&&r.turn_id===turnId).slice(-20)
      .map(r=>{const status=r.status==='inProgress'&&(!available||nativeStatus!=='running')?'unknown':r.status;
        return {...r,status,summary:reasons[status]};});
    return {source:'native_codex',connection:available?'connected':'disconnected',coverage:'current_connection_only',reviews};
  }
}
