import 'dotenv/config';
import { initDb,sql } from '../db.js';
import { migrateV2 } from './schema.js';
import { runOnce } from './runner.js';
let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
await initDb();await migrateV2(sql);
while(!stopping){
 try{console.log('Worker run:',await runOnce());}catch(error){console.error('Worker run:',error.message);}
 if(!stopping)await new Promise(resolve=>setTimeout(resolve,30000));
}
