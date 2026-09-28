import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { setGlobalDispatcher, Agent } from 'undici';
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

import { app } from '../backend/src/app.js';
import { initDb } from '../backend/src/db.js';

let dbInitialized = false;

export default async function handler(req, res) {
  if (!dbInitialized) {
    try {
      await initDb();
      dbInitialized = true;
    } catch (e) {
      console.error('Lazy DB initialization error in serverless handler:', e);
    }
  }
  return app(req, res);
}
