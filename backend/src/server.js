import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { setGlobalDispatcher, Agent } from 'undici';
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { initDb } from './db.js';
import { startContinuousSync } from './indexer.js';
import apiRouter from './routes/api.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Routes
app.use('/api', apiRouter);

// Root greeting
app.get('/', (req, res) => {
  res.json({
    name: 'Vantage Prediction Market API',
    description: 'Autonomous resolution protocol powered by GenLayer Intelligent Contracts',
    docs: '/api/health',
  });
});

// Start server
async function startServer() {
  try {
    await initDb();
    startContinuousSync(6000);

    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n========================================`);
      console.log(`VANTAGE API SERVER RUNNING ON PORT ${PORT}`);
      console.log(`Health: http://localhost:${PORT}/api/health`);
      console.log(`Markets: http://localhost:${PORT}/api/markets`);
      console.log(`Charter: http://localhost:${PORT}/api/charter`);
      console.log(`========================================\n`);
    });
  } catch (err) {
    console.error('Fatal server boot error:', err);
    process.exit(1);
  }
}

startServer();
