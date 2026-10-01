import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseDecision,githubOutput} from '../scripts/release.mjs';
const pkg={name:'factory-software-defence',version:'0.18.0',repository:{url:'https://github.com/arcitai/factory-software-defence.git'},publishConfig:{tag:'next'}};
const reply=(status,value)=>({status,ok:status===200,json:async()=>value});
test('breaking release compares the explicit next channel, not latest',async()=>{
  const calls=[];
  const decision=await releaseDecision(pkg,async url=>{calls.push(url);return calls.length===1?reply(404):reply(200,{name:pkg.name,version:'0.17.0'});});
  assert.deepEqual(decision,{publish:true,channel:'next'});
  assert.ok(calls.every(url=>url.startsWith('https://registry.npmjs.org/factory-software-defence/')));
  assert.deepEqual(calls.map(url=>url.split('/').at(-1)),['0.18.0','next']);
  assert.equal(githubOutput(pkg,decision),'publish=true\nversion=0.18.0\nchannel=next\n');
});
test('latest release uses the validated latest channel in the decision and output',async()=>{
  const latest={...pkg,publishConfig:{tag:'latest'}},calls=[];
  const decision=await releaseDecision(latest,async url=>{calls.push(url);return calls.length===1?reply(404):reply(200,{name:latest.name,version:'0.17.0'});});
  assert.deepEqual(decision,{publish:true,channel:'latest'});
  assert.deepEqual(calls.map(url=>url.split('/').at(-1)),['0.18.0','latest']);
  assert.equal(githubOutput(latest,decision),'publish=true\nversion=0.18.0\nchannel=latest\n');
});
test('published versions are not republished',async()=>{
  const decision=await releaseDecision(pkg,async()=>reply(200));
  assert.deepEqual(decision,{publish:false,channel:'next'});
  assert.equal(githubOutput(pkg,decision),'publish=false\nversion=0.18.0\nchannel=next\n');
});
test('unknown registry state refuses publication',async()=>{
  await assert.rejects(releaseDecision(pkg,async()=>reply(503)),/Version lookup failed/);
  let n=0;await assert.rejects(releaseDecision(pkg,async()=>reply(++n===1?404:503)),/Channel lookup failed/);
});
test('channel downgrade and malformed identity refuse publication',async()=>{
  let n=0;await assert.rejects(releaseDecision(pkg,async()=>++n===1?reply(404):reply(200,{name:pkg.name,version:'0.19.0'})),/increase/);
  await assert.rejects(releaseDecision({...pkg,name:'other'},async()=>reply(404)),/identity/);
  await assert.rejects(releaseDecision({...pkg,repository:{url:'https://github.com/arcitai/software-and-defence-factory.git'}},async()=>reply(404)),/identity/);
  let called=false;
  await assert.rejects(releaseDecision({...pkg,publishConfig:{tag:'beta'}},async()=>{called=true;return reply(404);}),/channel/);
  assert.equal(called,false);
});
