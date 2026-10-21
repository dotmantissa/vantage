import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {outcome} from '../../backend/src/v2/outcome.js';
test('stable SDK execution names and numeric states are decoded together',()=>{
 assert.equal(outcome({status:5,txExecutionResultName:'FINISHED_WITH_ERROR'},'hash','studionet').successful,false);
 assert.equal(outcome({status:7,txExecutionResultName:'FINISHED_WITH_RETURN'},'hash','studionet').successful,true);
});
test('transaction recovery saves the hash before tracking and has no relayer fallback',()=>{
 const code=readFileSync('frontend/src/v2/transactions.js','utf8');
 assert.ok(code.indexOf('saveTransaction({hash,method')<code.indexOf("api('/transactions'"));
 assert.ok(!code.includes('/relay'));
 assert.match(code,/getMinAppealBond/);
});
test('native operations preserve GenLayer identity rather than polling EVM hashes',()=>{
 const code=readFileSync('frontend/src/v2/transactions.js','utf8');
 assert.match(code,/finalization_evm_hash:evmHash/);
 assert.match(code,/native_appeal_at:Date.now/);
 assert.ok(!/(?:[,{]\s*)hash:evmHash/.test(code));
});
test('bigint receipt data can be served as JSON without losing precision',()=>{
 const result=outcome({status:'FINALIZED',txExecutionResultName:'FINISHED_WITH_RETURN',nonce:9007199254740993n},'hash','testnet_bradbury');
 assert.equal(result.raw.nonce,'9007199254740993');assert.doesNotThrow(()=>JSON.stringify(result));
});
