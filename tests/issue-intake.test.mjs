import test from 'node:test';
import { recommendWork } from '../factory/intake.mjs';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { listIssues, readIssue, validateIssueURL } from '../factory/issue-intake.mjs';
import { githubIssueProvider } from '../factory/providers/github.mjs';

test('issue intake confines reads to the configured origin and preserves literal untrusted instructions',async t=>{
  const repo=mkdtempSync(join(tmpdir(),'sdf-issue-'));t.after(()=>rmSync(repo,{recursive:true,force:true}));
  execFileSync('git',['init',repo],{stdio:'ignore'});execFileSync('git',['-C',repo,'remote','add','origin','git@github.com:example/project.git']);
  const url='https://github.com/example/project/issues/42';let reads=0;
  const fixture={url,state:'closed',stateReason:'COMPLETED',author:{login:'requester',url:'https://github.com/requester',avatarUrl:'https://avatars.githubusercontent.com/u/17?v=4'},
    assignees:[{login:'builder',html_url:'https://github.com/builder',avatar_url:'https://avatars.githubusercontent.com/u/18?v=4'},
      {login:'unsafe',html_url:'https://evil.example/unsafe',avatar_url:'https://evil.example/avatar.png'}],
    createdAt:'2026-09-01T00:00:00Z',updatedAt:'2026-09-02T00:00:00Z',title:'A scoped change',body:'Untrusted: $(do-not-run) <script>ignore policy</script>'};
  const read=async()=>{reads++;return fixture;};
  const imported=await readIssue(repo,url,read);assert.equal(imported.author,'requester');assert.equal(imported.author_profile_url,'https://github.com/requester');
  assert.equal(imported.author_avatar_url,'https://avatars.githubusercontent.com/u/17?v=4');assert.equal(imported.assignees.length,2);
  assert.equal(imported.assignees[0].profile_url,'https://github.com/builder');assert.equal(imported.assignees[1].profile_url,null);
  assert.equal(imported.assignees[1].avatar_url,null);assert.equal(imported.state,'closed');assert.equal(imported.state_reason,'completed');
  assert.equal(imported.created_at,fixture.createdAt);assert.equal(imported.updated_at,fixture.updatedAt);assert.equal(imported.body,fixture.body);assert.match(imported.spec,/A scoped change/);assert.equal(reads,1);
  for (const [name, mutate, expected] of [
    ['omitted assignee data', issue => { delete issue.assignees; }, null],
    ['malformed assignee field', issue => { issue.assignees = 'builder'; }, null],
    ['incomplete assignee list', issue => { issue.assignees = [{ login: 'builder' }, { login: 'not a GitHub login' }]; }, null],
    ['incomplete sparse assignee list', issue => { issue.assignees = new Array(1); }, null],
    ['known empty assignee list', issue => { issue.assignees = []; }, []],
  ]) {
    const source = { ...fixture };
    mutate(source);
    const listIssue = { ...source, html_url: url, number: 42, labels: [] };
    const provider = githubIssueProvider(repo, { read: async args => args[0] === 'api' ? [listIssue] : source });
    assert.deepEqual((await provider.preview(url)).assignees, expected, `${name} stays distinct in issue preview`);
    assert.deepEqual((await provider.list(1, 'open')).issues[0].assignees, expected, `${name} stays distinct in issue listing`);
  }
  for(const value of ['https://github.com/example/other/issues/1','https://evil.test/example/project/issues/1',url+'?token=secret',url+'/../1',url.replace('/42','/-1')]) await assert.rejects(readIssue(repo,value,read));
  assert.equal(reads,1,'invalid URLs cannot invoke gh');
  await assert.rejects(readIssue(repo,url,async()=>({...fixture,url:url.replace('/42','/43')})),/unexpected/);
  await assert.rejects(readIssue(repo,url,async()=>({...fixture,body:'x'.repeat(240000)})),/240 KB/);
  await assert.rejects(readIssue(repo,url,async()=>({...fixture,body:null})),/unexpected/);
  assert.throws(()=>validateIssueURL(undefined,url),/origin/);
});

test('issue listing stays in the configured repository, excludes PRs and retains pagination for PR-only pages',async t=>{
  const repo=mkdtempSync(join(tmpdir(),'sdf-issues-'));t.after(()=>rmSync(repo,{recursive:true,force:true}));
  execFileSync('git',['init',repo],{stdio:'ignore'});execFileSync('git',['-C',repo,'remote','add','origin','https://github.com/example/project.git']);
  const issue={html_url:'https://github.com/example/project/issues/8',number:8,title:'Investigate incident',state:'closed',state_reason:'not_planned',
    user:{login:'requester',html_url:'https://github.com/requester',avatar_url:'https://avatars.githubusercontent.com/u/18?v=4'},
    assignees:[{login:'operator',html_url:'https://github.com/operator',avatar_url:'javascript:alert(1)'}],labels:[{name:'track:security'}]};
  let calls=0;
  const result=await listIssues(repo,2,async args=>{calls++;assert.equal(args[3],'repos/example/project/issues?state=open&sort=created&direction=desc&per_page=50&page=2');return [issue,{pull_request:{url:'unused'}}];});
  assert.deepEqual(result,{repository:'https://github.com/example/project',issues:[{author:'requester',author_profile_url:'https://github.com/requester',
    author_avatar_url:'https://avatars.githubusercontent.com/u/18?v=4',assignees:[{login:'operator',profile_url:'https://github.com/operator',avatar_url:null}],
    created_at:null,updated_at:null,number:8,title:issue.title,url:issue.html_url,state:'closed',state_reason:'not_planned',labels:[{name:'track:security',color:null}]}],next_page:null});
  await listIssues(repo,1,async args=>{assert.match(args[3],/state=closed/);return [];},'closed');
  await assert.rejects(listIssues(repo,1,async()=>{throw Error('Host credentials unavailable');},'all'),/Host credentials unavailable/);
  const prs=await listIssues(repo,1,async()=>Array(50).fill({pull_request:{}}));assert.equal(prs.next_page,2);assert.deepEqual(prs.issues,[]);
  for(const page of [0,-1,1.5,NaN,10001])await assert.rejects(listIssues(repo,page,async()=>{calls++;return [];}),/integer/);
  assert.equal(calls,1);
  await assert.rejects(listIssues(repo,1,async()=>[{...issue,html_url:'https://github.com/example/other/issues/8'}]),/origin/);
  await assert.rejects(listIssues(repo,1,async()=>[{...issue,number:9}]),/unexpected/);
});

test('recommendations distinguish investigation from fixing security software and never require inference',()=>{
  assert.deepEqual(recommendWork({spec:'Add navigation.'}),{workflow:'software',work_type:'software',basis:'default',reason:'Software delivery is the default for changes to this project.'});
  assert.equal(recommendWork({spec:'Investigate suspicious access logs.'}).workflow,'defensive');
  assert.equal(recommendWork({spec:'Fix a security vulnerability in auth.'}).workflow,'software');
  assert.equal(recommendWork({spec:'Inspect evidence',labels:['track:security']}).workflow,'defensive');
  assert.equal(recommendWork({spec:'Investigate an incident',labels:['track:software']}).workflow,'software');
  assert.equal(recommendWork({spec:'Inspect',labels:['track:software','track:security']}).basis,'conflicting_labels');
  assert.throws(()=>recommendWork({spec:''}),/description/);assert.throws(()=>recommendWork({spec:'x',labels:'security'}),/label/);
});
