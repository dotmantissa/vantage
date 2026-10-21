// Broadcast is not transactional with Postgres. Persist an intent first and
// refuse automatic retries of an uncertain broadcast. Operators reconcile the
// sender nonce/hash before resetting an intent; losing the response never means
// the network rejected it.
export async function submitDurably(sql,job,broadcast){
 if(job.payload.submitted_hash)return job.payload.submitted_hash;
 if(job.payload.broadcast_state==='broadcasting')throw new Error('UNCERTAIN_BROADCAST: reconcile sender transaction before retry');
 const intent=await sql`UPDATE v2_jobs SET payload=payload||${JSON.stringify({broadcast_state:'broadcasting'})}::jsonb,updated_at=now() WHERE id=${job.id} AND lease_owner=${job.lease_owner} AND lease_until>now() RETURNING id`;
 if(!intent.length)throw new Error('Job lease expired before broadcast');
 const hash=await broadcast();
 await sql`UPDATE v2_jobs SET payload=payload||${JSON.stringify({broadcast_state:'submitted',submitted_hash:hash})}::jsonb,updated_at=now() WHERE id=${job.id} AND lease_owner=${job.lease_owner}`;
 return hash;
}
