import test from 'node:test';
import assert from 'node:assert/strict';
import { outcome } from '../../backend/src/v2/outcome.js';
import { evidenceBundle } from '../../backend/src/v2/archive.js';
import { configuration } from '../../backend/src/v2/config.js';
import { verifyPrivyToken } from '../../backend/src/auth.js';
import { lease, fail } from '../../backend/src/v2/jobs.js';

test('accepted execution errors are never reported as successful',()=>{
  assert.equal(outcome({status:'ACCEPTED',consensus_data:{leader_receipt:[{execution_result:'VM_ERROR'}]}},'hash','studionet').successful,false);
  assert.equal(outcome({status:'FINALIZED',consensus_data:{leader_receipt:[{execution_result:'SUCCESS'}]}},'hash','studionet').successful,true);
});
test('evidence bundle keys are content addressed and archival role explicit',()=>{
  const e={id:'m-1:e-1',content_hash:'0x123',observed_at:1};
  const a=evidenceBundle(e),b=evidenceBundle(e);
  assert.equal(a.key,b.key);assert.match(a.key,/^consensus\/[0-9a-f]{64}\.json$/);
  assert.equal(JSON.parse(a.body).kind,'consensus-evidence-record');
  assert.notEqual(a.key,evidenceBundle({...e,observed_at:2}).key);
});
test('unknown chain fails closed and undeployed V2 is explicit',()=>{
  assert.throws(()=>configuration({VANTAGE_NETWORK:'wrong'}),/Unknown/);
  assert.equal(configuration({VANTAGE_NETWORK:'localnet',V2_DEPLOYMENT_FILE:'/tmp/vantage-test-no-manifest.json'}).configured,false);
});
test('missing Privy configuration rejects arbitrary bearer tokens',async()=>{
  assert.equal(await verifyPrivyToken('Bearer arbitrary-token'),null);
});
test('job leasing is atomic, restartable and bounded retry backs off',async()=>{
  const queries=[];const sql=async(strings,...values)=>{queries.push({text:strings.join('?'),values});return [{id:1,lease_owner:'worker',attempts:2}];};
  await lease(sql,'worker');assert.match(queries[0].text,/FOR UPDATE SKIP LOCKED/);assert.match(queries[0].text,/lease_until<now/);
  await fail(sql,{id:1,lease_owner:'worker',attempts:2},new Error('Temporary failure'));
  assert.ok(queries[1].values.includes(20));assert.ok(queries[1].values.includes('pending'));
});
