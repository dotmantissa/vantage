import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../../backend/src/v2/runner.js';
test('cutover rejects legacy and other-contract mutation jobs before any RPC or signer',async()=>{
  const config={contracts:{market:'0x1111111111111111111111111111111111111111'}};
  await assert.doesNotReject(handle({kind:'lifecycle',payload:{market_id:'m-1',method:'resolve'}},config));
  await assert.doesNotReject(handle({kind:'evidence',payload:{market_id:'m-1',contract:'0x2222222222222222222222222222222222222222'}},config));
});
