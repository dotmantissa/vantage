import { randomUUID } from 'node:crypto';
import { sql } from '../db.js';
import { configuration, chainClient, read } from './config.js';
import { indexV2 } from './indexer.js';
import { enqueue, lease, complete, fail, WaitingJob } from './jobs.js';
import {pendingBroadcasts} from './queue.js';
import { archiveEvidence } from './archive.js';
import {submitDurably} from './submission.js';
import { outcome } from './outcome.js';
export async function schedule(config) {
  if(!config.configured)return;
  if((await pendingBroadcasts(sql,config)).length)return;
  const rows=await sql`SELECT body FROM v2_markets WHERE network=${config.network} AND contract=${config.contracts.market}`;
  const now=Math.floor(Date.now()/1000);
  for(const {body:cached} of rows) {
    const m=await read('get_market',[cached.market_id],'market',config,true);
    const mid=m.market_id;
    let method=null;
    if(m.state==='OPEN'&&now>=m.spec.close_time)method='close_market';
    else if(['CLOSED','AWAITING_EVIDENCE','CHALLENGED','APPEALED'].includes(m.state)&&now>=Math.max(m.spec.observation.end,m.next_retry||0))method='resolve';
    else if(m.state==='PROVISIONAL'&&now>m.appeal_deadline)method='finalize';
    else if(m.state==='FINAL')method='settle';
    if(method)await enqueue(sql,`${config.network}:${config.contracts.market}:${mid}:${method}:${m.state}:${m.resolution_revision}:${m.next_retry||0}`,'lifecycle',{market_id:mid,method,contract:config.contracts.market});
    if(['OPEN','CLOSED','AWAITING_EVIDENCE','PROVISIONAL','CHALLENGED','APPEALED'].includes(m.state)&&now<= (m.terminal_deadline||m.grace_deadline)) {
      for(let i=0;i<m.spec.sources.length;i++)await enqueue(sql,`${config.network}:${config.contracts.market}:${mid}:evidence:${i}:${Math.floor(now/900)}`,'evidence',{market_id:mid,source_index:i,contract:config.contracts.market});
    }
  }
}
export async function handle(job,config,{database=sql}={}) {
  if(job.kind==='index')return indexV2(sql,config);
  if(job.kind==='archive') {
    const key=await archiveEvidence(job.payload.evidence,process.env,sql);
    if(key)await sql`UPDATE v2_evidence SET archive_key=${key} WHERE network=${config.network} AND contract=${config.contracts.market} AND evidence_id=${job.payload.evidence.id} AND body=${JSON.stringify(job.payload.evidence)}::jsonb`;
    return;
  }
  if(job.kind==='track') {
    const client=chainClient(config);const tx=await client.getTransaction({hash:job.payload.hash});const result=outcome(tx,job.payload.hash,config.network);
    await database`UPDATE v2_transactions SET body=${JSON.stringify(result)}::jsonb,updated_at=now() WHERE network=${config.network} AND tx_hash=${job.payload.hash}`;
    if(!result.finalized&&!['UNDETERMINED','CANCELED','CANCELLED','LEADER_TIMEOUT','VALIDATORS_TIMEOUT'].includes(result.status))throw new WaitingJob(`Waiting for network consensus: ${job.payload.hash} (${result.status})`);
    return;
  }
  // A cutover must never apply an old market's scheduled action to the same
  // local ID in another contract. Unscoped legacy jobs require reconciliation.
  if(job.payload.contract?.toLowerCase()!==config.contracts.market.toLowerCase())return;
  if(job.payload.submitted_hash){
    if(job.payload.actor)await sql`INSERT INTO v2_transactions(network,contract,tx_hash,actor,method,market_id) VALUES(${config.network},${config.contracts.market},${job.payload.submitted_hash},${job.payload.actor},${job.payload.method||'record_evidence'},${job.payload.market_id}) ON CONFLICT DO NOTHING`;
    await enqueue(sql,`track:${job.payload.submitted_hash}`,'track',{hash:job.payload.submitted_hash});return;
  }
  const pending=await pendingBroadcasts(database,config);
  if(pending.length)throw new WaitingJob(`Waiting for contract queue: ${pending[0].tx_hash} (${pending[0].status||'PENDING'})`);
  if(!process.env.KEEPER_KEY)throw new Error('KEEPER_KEY not configured');
  const client=chainClient(config,process.env.KEEPER_KEY);
  // Recheck current state before mutation; another keeper may already have acted.
  const m=await read('get_market',[job.payload.market_id],'market',config,true);
  if(['SETTLED','VOID'].includes(m.state))return;
  const method=job.kind==='evidence'?'record_evidence':job.payload.method;
  if(job.kind==='evidence'){
    const evidence=await read('get_evidence',[m.market_id],'market',config,true);
    const policy=await read('get_charter',[m.spec.charter_version],'charter',config,true);
    const count=evidence.filter(e=>e.source_index===job.payload.source_index).length;
    const budget=Math.floor(policy.max_evidence/m.spec.sources.length);
    if(count>=budget||(Date.now()/1000<m.spec.observation.end&&count>=Math.floor(budget/2)))return;
  }
  const args=job.kind==='evidence'?[m.market_id,job.payload.source_index]:[m.market_id];
  if(job.kind==='lifecycle'&&((method==='close_market'&&m.state!=='OPEN')||(method==='resolve'&&!['CLOSED','AWAITING_EVIDENCE','CHALLENGED','APPEALED'].includes(m.state))||(method==='finalize'&&m.state!=='PROVISIONAL')||(method==='settle'&&m.state!=='FINAL')))return;
  await sql`UPDATE v2_jobs SET payload=payload||${JSON.stringify({actor:client.account.address.toLowerCase(),method})}::jsonb WHERE id=${job.id} AND lease_owner=${job.lease_owner}`;
  const hash=await submitDurably(sql,job,()=>client.writeContract({address:config.contracts.market,functionName:method,args,value:0n}));
  await sql`INSERT INTO v2_transactions(network,contract,tx_hash,actor,method,market_id) VALUES(${config.network},${config.contracts.market},${hash},${client.account.address.toLowerCase()},${method},${m.market_id}) ON CONFLICT DO NOTHING`;
  await enqueue(sql,`track:${hash}`,'track',{hash});
}

export async function runOnce({budgetMs=35000,maxJobs=4}={}) {
  const owner=randomUUID(),started=Date.now(),config=configuration();
  const result={configured:config.configured,processed:0,failed:0,waiting:0};
  if(!config.configured)return result;
  const locks=await sql`INSERT INTO v2_service_locks(name,owner,expires_at) VALUES('keeper',${owner},now()+interval '2 minutes') ON CONFLICT(name) DO UPDATE SET owner=EXCLUDED.owner,expires_at=EXCLUDED.expires_at WHERE v2_service_locks.expires_at<now() RETURNING owner`;
  if(!locks.length)return {...result,skipped:'Another keeper invocation holds the lease'};
  await sql`INSERT INTO v2_service_runs(owner,started_at) VALUES(${owner},now())`;
  try {
    // Older releases exhausted their retry budget on healthy pending hashes.
    // Resume observation only; this never repeats the signed submission.
    await sql`UPDATE v2_jobs SET state='pending',attempts=0,run_at=now(),updated_at=now() WHERE kind='track' AND state='failed' AND last_error='Transaction still pending'`;
    // Preserve the journal, but retire obsolete mutation jobs after a cutover.
    // Their broadcasts remain discoverable in transactions/retained chain state.
    await sql`UPDATE v2_jobs SET state='done',lease_until=NULL,updated_at=now() WHERE kind IN ('lifecycle','evidence') AND state IN ('pending','failed') AND (payload->>'contract' IS NULL OR lower(payload->>'contract')<>${config.contracts.market.toLowerCase()})`;
    result.index=await indexV2(sql,config);
    await schedule(config);
    const rows=await sql`SELECT body FROM v2_evidence WHERE network=${config.network} AND contract=${config.contracts.market} AND archive_key IS NULL LIMIT 100`;
    for(const e of rows)await enqueue(sql,`archive:${config.network}:${config.contracts.market}:${e.body.id}:${e.body.content_hash}:${e.body.recorded_at}`,'archive',{evidence:e.body});
    while(result.processed+result.failed+result.waiting<maxJobs && Date.now()-started<budgetMs) {
      const job=await lease(sql,owner);
      if(!job)break;
      try{await handle(job,config);await complete(sql,job);result.processed++;}
      catch(error){await fail(sql,job,error);if(error instanceof WaitingJob)result.waiting++;else result.failed++;}
    }
    await sql`UPDATE v2_service_runs SET finished_at=now(),body=${JSON.stringify(result)}::jsonb WHERE owner=${owner}`;
    return result;
  } catch(error) {
    await sql`UPDATE v2_service_runs SET finished_at=now(),body=${JSON.stringify({...result,error:error.message.slice(0,400)})}::jsonb WHERE owner=${owner}`;
    throw error;
  } finally {
    await sql`DELETE FROM v2_service_locks WHERE name='keeper' AND owner=${owner}`;
  }
}
