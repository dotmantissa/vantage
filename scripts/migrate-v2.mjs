import 'dotenv/config';
import {sql} from '../backend/src/db.js';
import {migrateV2} from '../backend/src/v2/schema.js';
if(!process.env.DATABASE_URL)throw new Error('Set DATABASE_URL before applying additive V2 migrations.');
await migrateV2(sql);console.log('V2 additive migrations completed.');
