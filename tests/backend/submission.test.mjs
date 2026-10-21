import test from 'node:test';
import assert from 'node:assert/strict';
import {submitDurably} from '../../backend/src/v2/submission.js';
import {archiveEvidence} from '../../backend/src/v2/archive.js';
test('broadcast intent is persisted before send and hash before completion',async()=>{const events=[];const sql=async(s,...v)=>{events.push(JSON.parse(v[0]));return [{id:1}];};const hash=await submitDurably(sql,{id:1,lease_owner:'a',payload:{}},async()=>{assert.equal(events[0].broadcast_state,'broadcasting');return '0xhash';});assert.equal(hash,'0xhash');assert.equal(events[1].submitted_hash,hash);});
test('uncertain broadcasts never resubmit, submitted hashes resume',async()=>{let sends=0;const send=async()=>{sends++;};await assert.rejects(submitDurably(async()=>{},{payload:{broadcast_state:'broadcasting'}},send),/UNCERTAIN_BROADCAST/);assert.equal(await submitDurably(async()=>{},{payload:{submitted_hash:'existing'}},send),'existing');assert.equal(sends,0);});
test('unconfigured archives fail visibly rather than acknowledging retention',async()=>{await assert.rejects(archiveEvidence({id:'e'},{}),/archive unavailable/);});

test('an expired lease cannot broadcast',async()=>{let sent=false;await assert.rejects(submitDurably(async()=>[],{payload:{},id:1,lease_owner:'expired'},async()=>{sent=true;}),/lease expired/);assert.equal(sent,false);});
