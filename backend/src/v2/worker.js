import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { sql, initDb } from '../db.js';
import { migrateV2 } from './schema.js';
import { configuration, chainClient, read } from './config.js';
import { indexV2 } from './indexer.js';
import { enqueue, lease, complete, fail } from './jobs.js';
import { archiveEvidence } from './archive.js';
import { outcome } from './outcome.js';
const owner=randomUUID();let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
await initDb();await migrateV2(sql);
async function schedule(config) {
  if(!config.configured)return;
  const rows=await sql`SELECT body FROM v2_markets WHERE network=${config.network} AND contract=${config.contracts.market}`;
  const now=Math.floor(Date.now()/1000);
  for(const {body:m} of rows) {
    const mid=m.market_id;
    let method=null;
    if(m.state==='OPEN'&&now>=m.spec.close_time)method='close_market';
    else if(['CLOSED','AWAITING_EVIDENCE','CHALLENGED','APPEALED'].includes(m.state)&&now>=Math.max(m.spec.observation.end,m.next_retry||0))method='resolve';
    else if(m.state==='PROVISIONAL'&&now>m.appeal_deadline)method='finalize';
    else if(m.state==='FINAL')method='settle';
    if(method)await enqueue(sql,`${config.network}:${mid}:${method}:${m.resolution_revision}:${Math.floor(now/60)}`,'lifecycle',{market_id:mid,method});
    if(!['SETTLED','VOID'].includes(m.state)&&now<= (m.terminal_deadline||m.grace_deadline)) {
      for(let i=0;i<m.spec.sources.length;i++)await enqueue(sql,`${config.network}:${mid}:evidence:${i}:${Math.floor(now/900)}`,'evidence',{market_id:mid,source_index:i});
    }
  }
}
async function handle(job,config) {
  if(job.kind==='index')return indexV2(sql,config);
  if(job.kind==='archive') {
    const key=await archiveEvidence(job.payload.evidence);
    if(key)await sql`UPDATE v2_evidence SET archive_key=${key} WHERE network=${config.network} AND contract=${config.contracts.market} AND evidence_id=${job.payload.evidence.id}`;
    return;
  }
  if(job.kind==='track') {
    const client=chainClient(config);const tx=await client.getTransaction({hash:job.payload.hash});const result=outcome(tx,job.payload.hash,config.network);
    await sql`UPDATE v2_transactions SET body=${JSON.stringify(result)}::jsonb,updated_at=now() WHERE network=${config.network} AND tx_hash=${job.payload.hash}`;
    if(!result.finalized&&!['UNDETERMINED','CANCELED','LEADER_TIMEOUT','VALIDATORS_TIMEOUT'].includes(result.status))throw new Error('Transaction still pending');
    return;
  }
  if(!process.env.KEEPER_KEY)throw new Error('KEEPER_KEY not configured');
  const client=chainClient(config,process.env.KEEPER_KEY);
  // Recheck current state before mutation; another keeper may already have acted.
  const m=await read('get_market',[job.payload.market_id],'market',config);
  if(['SETTLED','VOID'].includes(m.state))return;
  const method=job.kind==='evidence'?'record_evidence':job.payload.method;
  const args=job.kind==='evidence'?[m.market_id,job.payload.source_index]:[m.market_id];
  const hash=await client.writeContract({address:config.contracts.market,functionName:method,args,value:0n});
  await enqueue(sql,`track:${hash}`,'track',{hash});
}
let lastSchedule=0;
while(!stopping) {
  const config=configuration();
  try {
    if(Date.now()-lastSchedule>30000) {
      await indexV2(sql,config);await schedule(config);lastSchedule=Date.now();
      const rows=await sql`SELECT body FROM v2_evidence WHERE network=${config.network} AND archive_key IS NULL LIMIT 100`;
      for(const e of rows)await enqueue(sql,`archive:${config.network}:${e.body.id}`,'archive',{evidence:e.body});
    }
    const job=await lease(sql,owner);
    if(job){try{await handle(job,config);await complete(sql,job);}catch(error){await fail(sql,job,error);}}
    else await new Promise(resolve=>setTimeout(resolve,1000));
  }catch(error){console.error('Worker iteration:',error.message);await new Promise(resolve=>setTimeout(resolve,5000));}
}
