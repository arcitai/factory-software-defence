import test from 'node:test';
import assert from 'node:assert/strict';
import {checkRelease} from '../factory/release-check.mjs';
const metadata=version=>new Response(JSON.stringify({name:'factory-software-defence',version}));
const check=(candidate,version='0.18.2')=>checkRelease({version,channel:'next',request:async()=>metadata(candidate)});

test('release checks compare numeric versions and never recommend a downgrade or activation',async()=>{
  assert.equal((await check('0.18.10','0.18.9')).relation,'newer');
  assert.equal((await check('0.18.2')).update_available,false);
  const older=await check('0.17.0');assert.equal(older.relation,'older');assert.equal(older.update_available,false);
  const migration=await check('0.19.0');assert.equal(migration.same_version_line,false);assert.equal(migration.activation,'manual');
});

test('the selected channel uses only the public registry and rejects an implicit channel',async()=>{
  let calls=0;
  const request=async(url,options)=>{
    calls++;assert.equal(url,'https://registry.npmjs.org/factory-software-defence/latest');
    assert.equal(options.redirect,'error');assert.deepEqual(options.headers,{Accept:'application/json'});
    assert.ok(options.signal);return metadata('0.17.0');
  };
  await assert.rejects(checkRelease({version:'0.18.2',request}),/explicitly/);assert.equal(calls,0);
  const result=await checkRelease({version:'0.18.2',channel:'latest',request});assert.equal(result.relation,'older');assert.equal(calls,1);
});

test('unavailable or untrusted metadata stays an error rather than a current-release result',async()=>{
  const run=response=>checkRelease({version:'0.18.2',channel:'next',request:async()=>response});
  await assert.rejects(run(new Response('',{status:503})),/availability is unknown/);
  await assert.rejects(run(new Response('{')),/valid JSON/);
  await assert.rejects(run(new Response('null')),/identity/);
  await assert.rejects(run(new Response(JSON.stringify({name:'software-defence-factory',version:'0.18.3'}))),/identity/);
  await assert.rejects(check('1.0.0'),/migration manually/);
  await assert.rejects(check('0.18.3-beta.1'),/migration manually/);
  await assert.rejects(run(new Response('x'.repeat(256001))),/256 KB/);
  await assert.rejects(checkRelease({version:'0.18.2',channel:'next',request:async()=>{throw new Error('network unavailable');}}),/network unavailable/);
});
