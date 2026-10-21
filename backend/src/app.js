import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { setGlobalDispatcher, Agent } from 'undici';
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import apiRouter from './routes/api.js';
import v2Router from './v2/routes.js';

dotenv.config();

export const app = express();

// Middleware
app.use(cors({
  origin: process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : ['http://localhost:5173'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Routes
app.use('/api/v2', v2Router);
app.use('/api', apiRouter);


// Root greeting
app.get('/api', (req, res) => {
  res.json({
    name: 'Vantage Prediction Market API',
    description: 'Autonomous resolution protocol powered by GenLayer Intelligent Contracts',
    docs: '/api/health',
  });
});

const frontend= fileURLToPath(new URL('../../frontend/dist',import.meta.url));
if(fs.existsSync(path.join(frontend,'index.html'))){
  app.use(express.static(frontend));
  app.get('*',(req,res,next)=>req.path.startsWith('/api')?next():res.sendFile(path.join(frontend,'index.html')));
}
