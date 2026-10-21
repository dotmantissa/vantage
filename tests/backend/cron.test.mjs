import test from 'node:test';
import assert from 'node:assert/strict';
import {cronAuthorized} from '../../backend/src/v2/cron-auth.js';
import {archiveEvidence,evidenceBundle} from '../../backend/src/v2/archive.js';
test('cron requires exact bearer secret and fails closed when unset',()=>{
  assert.equal(cronAuthorized('Bearer abc','abc'),true);
  for(const header of [undefined,'abc','Bearer abcd','Bearer xyz'])assert.equal(cronAuthorized(header,'abc'),false);
  assert.equal(cronAuthorized('Bearer undefined',undefined),false);
});
test('Postgres archive retains exact content addressed bytes without overwriting',async()=>{
  const e={id:'e-1',facts:{released:true}},calls=[];
  const sql=async(s,...v)=>{calls.push({query:s.join('?'),values:v});};
  const key=await archiveEvidence(e,{VANTAGE_ARCHIVE:'postgres'},sql);
  assert.equal(key,evidenceBundle(e).key);
  assert.equal(calls[0].values[1],evidenceBundle(e).body.toString('utf8'));
  assert.match(calls[0].query,/ON CONFLICT\(archive_key\) DO NOTHING/);
});
