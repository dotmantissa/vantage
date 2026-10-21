import test from 'node:test';
import assert from 'node:assert/strict';
import {configuration,withDeployment} from '../../backend/src/v2/config.js';
test('retained deployment scope is allowlisted and does not leak to concurrent requests',async()=>{
  const active=configuration().contracts.market;
  const retained='0x7Cc9dd65dA0801Cf4eF3CdbaEAbF5bB4754396a9';
  const result=await withDeployment(retained,async()=>{
    await Promise.resolve();return configuration();
  });
  assert.equal(result.contracts.market,retained);assert.equal(result.retained,true);
  assert.equal(configuration().contracts.market,active);
  assert.throws(()=>withDeployment('0x1111111111111111111111111111111111111111',()=>{}),/Unknown retained/);
});
