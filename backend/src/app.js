import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { setGlobalDispatcher, Agent } from 'undici';
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import apiRouter from './routes/api.js';

dotenv.config();

export const app = express();

// Middleware
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json());

// Routes
app.use('/api', apiRouter);
app.use(apiRouter);

// Root greeting
app.get('/', (req, res) => {
  res.json({
    name: 'Vantage Prediction Market API',
    description: 'Autonomous resolution protocol powered by GenLayer Intelligent Contracts',
    docs: '/api/health',
  });
});
