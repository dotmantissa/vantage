import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
export function evidenceBundle(evidence) {
  const body=Buffer.from(JSON.stringify({schema_version:2,kind:'consensus-evidence-record',evidence}));
  const hash=createHash('sha256').update(body).digest('hex');
  return {body,key:`consensus/${hash}.json`,hash};
}
export async function archiveEvidence(evidence,env=process.env) {
  if(!env.R2_ENDPOINT||!env.R2_BUCKET||!env.R2_ACCESS_KEY_ID||!env.R2_SECRET_ACCESS_KEY)return null;
  const bundle=evidenceBundle(evidence);
  const client=new S3Client({region:'auto',endpoint:env.R2_ENDPOINT,credentials:{accessKeyId:env.R2_ACCESS_KEY_ID,secretAccessKey:env.R2_SECRET_ACCESS_KEY}});
  await client.send(new PutObjectCommand({Bucket:env.R2_BUCKET,Key:bundle.key,Body:bundle.body,ContentType:'application/json',IfNoneMatch:'*'})).catch(e=>{if(e.$metadata?.httpStatusCode!==412)throw e;});
  return bundle.key;
}
