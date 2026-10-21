import { randomUUID } from 'node:crypto';
export class WaitingJob extends Error {
  constructor(message) {super(message);this.name='WaitingJob';}
}
export async function enqueue(sql,key,kind,payload,delay=0) {
  await sql`INSERT INTO v2_jobs(dedupe_key,kind,payload,run_at) VALUES(${key},${kind},${JSON.stringify(payload)}::jsonb,now()+${delay}*interval '1 second') ON CONFLICT(dedupe_key) DO NOTHING`;
}
export async function lease(sql,owner=randomUUID()) {
  const rows=await sql`UPDATE v2_jobs SET state='running',lease_owner=${owner},lease_until=now()+interval '5 minutes',attempts=attempts+1,updated_at=now() WHERE id=(SELECT id FROM v2_jobs WHERE (state='pending' AND run_at<=now()) OR (state='running' AND lease_until<now()) ORDER BY run_at,id FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *`;
  return rows[0]||null;
}
export async function complete(sql,job) {await sql`UPDATE v2_jobs SET state='done',lease_until=NULL,updated_at=now() WHERE id=${job.id} AND lease_owner=${job.lease_owner}`;}
export async function fail(sql,job,error) {
  // Waiting for chain consensus is not a failed attempt. Keep the saved hash
  // recoverable even when validators take longer than the retry budget.
  if(error instanceof WaitingJob) {
    await sql`UPDATE v2_jobs SET state='pending',attempts=GREATEST(attempts-1,0),run_at=now()+interval '5 minutes',last_error=${error.message.slice(0,400)},lease_until=NULL,updated_at=now() WHERE id=${job.id} AND lease_owner=${job.lease_owner}`;
    return;
  }
  const delay=Math.min(3600,2**Math.min(job.attempts,10)*5);
  await sql`UPDATE v2_jobs SET state=${String(error.message).startsWith('UNCERTAIN_BROADCAST')||job.attempts>=10?'failed':'pending'},run_at=now()+${delay}*interval '1 second',last_error=${String(error.message).slice(0,400)},lease_until=NULL,updated_at=now() WHERE id=${job.id} AND lease_owner=${job.lease_owner}`;
}
