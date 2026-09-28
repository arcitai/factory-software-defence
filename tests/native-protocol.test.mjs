import test from 'node:test';
import assert from 'node:assert/strict';
import { AppServer, nativeReadiness } from '../factory/native/app-server.mjs';

test('JSONL client correlates requests, refuses unexpected authority and reports disconnect',async()=>{
  const frames=[];
  const client=new AppServer({config:{},env:{}});
  client.child={stdin:{writable:true,write:line=>frames.push(JSON.parse(line))}};
  const pending=client.call('thread/list',{sourceKinds:['appServer','exec']});
  assert.deepEqual(frames[0],{id:1,method:'thread/list',params:{sourceKinds:['appServer','exec']}});
  client.receive(JSON.stringify({id:1,result:{data:[],nextCursor:null}}));
  assert.deepEqual(await pending,{data:[],nextCursor:null});
  client.receive(JSON.stringify({id:77,method:'item/commandExecution/requestApproval',params:{threadId:'thread',turnId:'turn'}}));
  assert.deepEqual(frames[1],{id:77,result:{decision:'cancel'}});
  assert.deepEqual(frames[2],{id:2,method:'turn/interrupt',params:{threadId:'thread',turnId:'turn'}});
  client.receive(JSON.stringify({id:2,result:{}}));
  const uncertain=client.call('turn/start',{threadId:'thread',input:[]});
  client.disconnect();
  await assert.rejects(uncertain,/Native state unavailable/);
  assert.equal(client.unexpectedApproval,true);
});

test('readiness fails closed on effective configuration and installed connections without account details',async()=>{
  const responses={
    'account/read':{account:{email:'never-return-this@example.invalid'},requiresOpenaiAuth:true},
    'config/read':{config:{approval_policy:'never',web_search:'disabled',apps:{_default:{enabled:false}}},layers:[{name:{type:'user',file:'/private/.codex/config.toml'},config:{}},{name:{type:'project'},config:{mcp_servers:{extra:{}}}}]},
    'permissionProfile/list':{data:[{id:'factory',allowed:true}],nextCursor:null},
    'app/installed':{apps:[{id:'unexpected'}]},
    'mcpServerStatus/list':{data:[],nextCursor:null},
  };
  const client={available:true,unexpectedApproval:false,env:{CODEX_HOME:'/private/.codex'},call:async method=>responses[method]};
  const status=await nativeReadiness(client,{repo:'/repo'});
  assert.equal(status.ready,false);
  assert.match(status.gaps.join(';'),/Unreviewed effective configuration layer/);
  assert.match(status.gaps.join(';'),/Installed app status/);
  assert.equal(JSON.stringify(status).includes('never-return-this'),false);
});

test('malformed and native error frames refuse untrusted output',async()=>{
  for (const frame of ['{bad json', JSON.stringify({id:1,error:{message:'SECRET TOKEN and raw command'}})]) {
    let killed=false;
    const client=new AppServer({config:{},env:{}});
    client.child={stdin:{writable:true,write:()=>{}},kill:()=>{killed=true;}};
    const pending=client.call('thread/read',{});
    client.receive(frame);
    await assert.rejects(pending,error=>!error.message.includes('SECRET'));
    if (frame==='{bad json') assert.equal(killed,true);
  }
});

test('oversized read frame is discarded without killing a running native child',async()=>{
  let killed=false;const client=new AppServer({config:{},env:{}});
  client.child={stdin:{writable:true,write:()=>{}},kill:()=>{killed=true;}};
  const pending=client.call('thread/read',{},2);
  client.read(Buffer.alloc(16*1024*1024+1,65));
  client.read(Buffer.from('\n'));
  await assert.rejects(pending,/Native state unavailable/);
  assert.equal(killed,false);
  const next=client.call('thread/read',{});
  client.read(Buffer.from(JSON.stringify({id:2,result:{thread:{id:'still-connected'}}})+'\n'));
  assert.equal((await next).thread.id,'still-connected');
});

test('large valid and coalesced frames do not disconnect an active transport',async()=>{
  let killed=false;
  const client=new AppServer({config:{},env:{}});
  client.child={stdin:{writable:true,write:()=>{}},kill:()=>{killed=true;}};
  const pending=Array.from({length:3},()=>client.call('thread/turns/list',{}));
  const payload='x'.repeat(6*1024*1024);
  const frames=pending.map((_,index)=>JSON.stringify({id:index+1,result:{data:[],padding:payload}})+'\n');
  client.read(Buffer.from(frames.join('')));
  const values=await Promise.all(pending);
  assert.equal(values.length,3);
  assert.equal(values[0].padding.length,payload.length);
  assert.equal(killed,false);
});

test('a status read timeout leaves native execution connected and ignores its late reply',async()=>{
  let killed=false;const client=new AppServer({config:{},env:{}});
  client.child={stdin:{writable:true,write:()=>{}},kill:()=>{killed=true;}};
  await assert.rejects(client.call('thread/turns/list',{},1),/Native state unavailable/);
  assert.equal(killed,false);
  client.receive(JSON.stringify({id:1,result:{data:[]}}));
  const next=client.call('thread/read',{});
  client.receive(JSON.stringify({id:2,result:{thread:{id:'thread'}}}));
  assert.equal((await next).thread.id,'thread');
  assert.equal(killed,false);
});
