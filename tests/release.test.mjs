import test from 'node:test';
import assert from 'node:assert/strict';
import {releaseDecision} from '../scripts/release.mjs';
const pkg={name:'software-defence-factory',version:'0.18.0',publishConfig:{tag:'next'}};
const reply=(status,value)=>({status,ok:status===200,json:async()=>value});
test('breaking release compares the explicit next channel, not latest',async()=>{
  const calls=[];
  const publish=await releaseDecision(pkg,async url=>{calls.push(url);return calls.length===1?reply(404):reply(200,{name:pkg.name,version:'0.17.0'});});
  assert.equal(publish,true);assert.deepEqual(calls.map(url=>url.split('/').at(-1)),['0.18.0','next']);
});
test('published versions are not republished',async()=>assert.equal(await releaseDecision(pkg,async()=>reply(200)),false));
test('unknown registry state refuses publication',async()=>{
  await assert.rejects(releaseDecision(pkg,async()=>reply(503)),/Version lookup failed/);
  let n=0;await assert.rejects(releaseDecision(pkg,async()=>reply(++n===1?404:503)),/Channel lookup failed/);
});
test('channel downgrade and malformed identity refuse publication',async()=>{
  let n=0;await assert.rejects(releaseDecision(pkg,async()=>++n===1?reply(404):reply(200,{name:pkg.name,version:'0.19.0'})),/increase/);
  await assert.rejects(releaseDecision({...pkg,name:'other'},async()=>reply(404)),/identity/);
});
