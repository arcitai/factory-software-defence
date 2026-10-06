import test from 'node:test';
import assert from 'node:assert/strict';
import { ApprovalObservations, codexApprovals, confirmedApprovals } from '../factory/native/codex-approvals.mjs';
import { AppServer } from '../factory/native/app-server.mjs';

test('legacy profiles retain never; auto-review must be explicitly confirmed by native',()=>{
  assert.deepEqual(codexApprovals({}),{approvalPolicy:'never',approvalsReviewer:'user'});
  assert.throws(()=>codexApprovals({approvals:'full-access'}),/Unsupported/);
  assert.equal(confirmedApprovals({approvalPolicy:'on-request'},{approvals:'auto-review'}),false);
  assert.equal(confirmedApprovals({approvalPolicy:'on-request',approvalsReviewer:'user'},{approvals:'auto-review'}),false);
  assert.equal(confirmedApprovals({approvalPolicy:'on-request',approvalsReviewer:'auto_review'},{approvals:'auto-review'}),true);
});
const event=(status,extra={})=>({threadId:'thread-1',turnId:'turn-1',reviewId:'review-1',targetItemId:'item-1',decisionSource:'agent',
  review:{status,rationale:'SECRET payload /private/file',riskLevel:'low'},action:{command:'SECRET command'},...extra});
test('reviews correlate native identities, omit payloads, retain terminal decisions and report uncertainty',()=>{
  const cache=new ApprovalObservations();
  cache.observe('item/autoApprovalReview/started',event('inProgress'));
  assert.equal(cache.snapshot('other','turn-1',true,'running').reviews.length,0);
  assert.equal(cache.snapshot('thread-1','turn-1',false,'unknown').reviews[0].status,'unknown');
  assert.equal(cache.snapshot('thread-1','turn-1',true,'needs_review').reviews[0].status,'unknown');
  cache.observe('item/autoApprovalReview/completed',event('denied'));
  cache.observe('item/autoApprovalReview/started',event('inProgress'));
  const observed=cache.snapshot('thread-1','turn-1',true,'needs_review');
  assert.equal(observed.reviews[0].status,'denied');
  assert.equal(JSON.stringify(observed).includes('SECRET'),false);
  assert.equal(JSON.stringify(observed).includes('/private'),false);
  assert.equal(new ApprovalObservations().snapshot('thread-1','turn-1',true,'needs_review').reviews.length,0,'restart does not infer approval');
});
test('allow, timeout, interruption and malformed events stay distinct and bounded',()=>{
  const cache=new ApprovalObservations();
  for(const status of ['approved','timedOut','aborted'])cache.observe('item/autoApprovalReview/completed',event(status,{reviewId:status}));
  cache.observe('item/autoApprovalReview/completed',event('approved',{decisionSource:'unknown'}));
  cache.observe('item/autoApprovalReview/completed',event('approved',{reviewId:'/private/file'}));
  assert.deepEqual(cache.snapshot('thread-1','turn-1',true,'running').reviews.map(r=>r.status),['approved','timedOut','aborted']);
  for(let i=0;i<240;i++)cache.observe('item/autoApprovalReview/completed',event('approved',{reviewId:`id-${i}`}));
  assert.equal(cache.reviews.size,200);assert.equal(cache.snapshot('thread-1','turn-1',true,'running').reviews.length,20);
});
test('a native reviewer downgrade blocks admission and interrupts the owning engine via its existing guard',()=>{
  const client=new AppServer({config:{repo:'/repo',approvals:'auto-review'},env:{}}),events=[];
  client.onNotification(event=>events.push(event));
  client.receive(JSON.stringify({method:'thread/settings/updated',params:{threadId:'thread-1',threadSettings:{cwd:'/repo',approvalPolicy:'on-request',approvalsReviewer:'user',activePermissionProfile:{id:'factory'}}}}));
  assert.equal(client.unexpectedApproval,true);assert.equal(events[0].method,'native/unexpectedRequest');
});
