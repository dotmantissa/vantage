import test from 'node:test';
import assert from 'node:assert/strict';
import {createReadCache} from '../../backend/src/v2/rpc-cache.js';
test('concurrent public reads share RPC work but expiry refreshes state',async()=>{
  let time=0,calls=0;const cache=createReadCache({now:()=>time});
  const load=async()=>({revision:++calls});
  const values=await Promise.all([cache('accepted',load,10),cache('accepted',load,10)]);
  assert.deepEqual(values,[{revision:1},{revision:1}]);assert.equal(calls,1);
  assert.deepEqual(await cache('finalized',load,10),{revision:2});
  time=11;assert.deepEqual(await cache('accepted',load,10),{revision:3});
});
test('RPC failures are evicted and a bounded cache can refresh evicted keys',async()=>{
  const cache=createReadCache({maxEntries:1});
  await assert.rejects(cache('a',()=>Promise.reject(new Error('Rate limited'))),/Rate limited/);
  assert.equal(await cache('a',()=>1),1);assert.equal(await cache('b',()=>2),2);
  assert.equal(await cache('a',()=>3),3);
});
