import test from 'node:test';
import assert from 'node:assert/strict';
import { createStatusLoader } from './status-loader.js';

test('newer failure wins over stale success and preserves an honest loading state',async()=>{
  let finish;const applied=[];let calls=0;
  const loader=createStatusLoader({request:()=>++calls===1?new Promise(resolve=>{finish=resolve;}):Promise.reject(new Error('Status unavailable')),
    apply:value=>applied.push(value)});
  const first=loader.refresh();await loader.refresh();finish({jobs:[]});await first;
  assert.deepEqual(applied,[{kind:'error',message:'Status unavailable'}]);
});
