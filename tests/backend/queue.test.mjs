import test from 'node:test';
import assert from 'node:assert/strict';
import {handle} from '../../backend/src/v2/runner.js';
import {fail,WaitingJob} from '../../backend/src/v2/jobs.js';
import {pendingBroadcasts} from '../../backend/src/v2/queue.js';
import {transactionTerminal,transactionMessage} from '../../frontend/src/v2/transaction-state.js';
const config={network:'studionet',contracts:{market:'0x1111111111111111111111111111111111111111'}};
test('leader execution does not mislabel a pending consensus as failed',()=>{
  assert.equal(transactionMessage({status:'COMMITTING',execution:'SUCCESS',successful:false}),'COMMITTING · awaiting validator consensus');
  assert.equal(transactionMessage({status:'FINALIZED',execution:'ERROR',successful:false}),'Contract execution failed');
  assert.equal(transactionTerminal({status:'CANCELED'}),true);
  assert.equal(transactionMessage({status:'CANCELED'}),'Transaction cancelled · state was not applied');
  assert.equal(transactionTerminal({status:'ACCEPTED'}),false);
});
test('a blocked contract cannot sign more automated writes',async()=>{
  let calls=0;
  const database=async()=>{calls++;return [{tx_hash:'saved-hash',status:'COMMITTING'}];};
  await assert.rejects(handle({kind:'evidence',payload:{contract:config.contracts.market,market_id:'m-2'}},config,{database}),error=>error instanceof WaitingJob&&error.message.includes('saved-hash'));
  assert.equal(calls,1);
});
test('waiting on consensus remains recoverable beyond ten attempts without losing the hash',async()=>{
  const calls=[],database=async(s,...v)=>{calls.push({query:s.join('?'),values:v});};
  await fail(database,{id:50,lease_owner:'owner',attempts:100},new WaitingJob('Waiting for network consensus: saved-hash (COMMITTING)'));
  assert.match(calls[0].query,/state='pending'/);
  assert.match(calls[0].query,/GREATEST\(attempts-1,0\)/);
  assert.doesNotMatch(calls[0].query,/payload=/);
  assert.ok(calls[0].values.includes('Waiting for network consensus: saved-hash (COMMITTING)'));
});
test('queue checks scope historical broadcasts and release accepted or terminal outcomes',async()=>{
  let query,values;
  await pendingBroadcasts(async(s,...v)=>{query=s.join('?');values=v;return [];},config);
  assert.match(query,/lower\(contract\)/);
  assert.match(query,/submitted_hash/);
  for(const terminal of ['ACCEPTED','FINALIZED','CANCELED','LEADER_TIMEOUT','VALIDATORS_TIMEOUT'])assert.ok(query.includes(terminal));
  assert.ok(values.includes(config.contracts.market));
});
