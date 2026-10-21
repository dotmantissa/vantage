import test from 'node:test';
import assert from 'node:assert/strict';
process.env.VANTAGE_NETWORK='localnet';
process.env.V2_DEPLOYMENT_FILE='/tmp/vantage-test-no-manifest.json';
const {app}=await import('../../backend/src/app.js');
let server,base;
test.before(async()=>{server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));base=`http://127.0.0.1:${server.address().port}`;});
test.after(()=>server.close());
test('undeployed markets return an honest empty list',async()=>{const res=await fetch(`${base}/api/v2/markets`);assert.equal(res.status,200);assert.deepEqual((await res.json()).markets,[]);});
test('V2 configuration exposes user signing and actual deployment state',async()=>{const data=await (await fetch(`${base}/api/v2/config`)).json();assert.equal(data.configured,false);assert.equal(data.capabilities.userSigning,true);});
test('authenticated writes fail closed',async()=>{const res=await fetch(`${base}/api/v2/transactions`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer arbitrary'},body:'{}'});assert.equal(res.status,401);});
test('keeper endpoints reject unauthenticated invocations',async()=>{const res=await fetch(`${base}/api/v2/cron`);assert.equal(res.status,401);});
test('invalid address fails before RPC work',async()=>{const res=await fetch(`${base}/api/v2/portfolio/invalid`);assert.equal(res.status,400);});
test('market workspace URLs are served as SPA pages when a build exists',async()=>{
 const res=await fetch(`${base}/markets/m-1`);
 if(res.status===200){assert.match(res.headers.get('content-type'),/text\/html/);assert.match(await res.text(),/<div id="root">/);}
 else assert.equal(res.status,404); // Build is a separate CI step.
});
