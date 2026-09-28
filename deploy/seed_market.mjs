/**
 * deploy/seed_market.mjs
 * 
 * Compiles and deploys a live seed market on GenLayer StudioNet.
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { setGlobalDispatcher, Agent } from 'undici';
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

import dotenv from 'dotenv';
import { chains, createClient, createAccount } from 'genlayer-js';

dotenv.config();

const RPC_URL = process.env.GENLAYER_RPC_URL || 'https://studio.genlayer.com/api';
const DEPLOYER_KEY = process.env.DEPLOYER_KEY;

if (!DEPLOYER_KEY) {
  console.error('ERROR: DEPLOYER_KEY missing in .env');
  process.exit(1);
}

const account = createAccount(DEPLOYER_KEY);
const client = createClient({
  chain: chains.studionet,
  endpoint: RPC_URL,
  account,
});

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const deployedPath = path.resolve(__dirname, '..', 'deployed_contracts.json');
const deployed = JSON.parse(fs.readFileSync(deployedPath, 'utf-8'));
const MARKET_CONTRACT = deployed.contracts.VantageMarket.address;

async function main() {
  console.log('Deployer Address:', account.address);
  console.log('VantageMarket Contract:', MARKET_CONTRACT);

  // Check existing market count
  const statsRaw = await client.readContract({
    address: MARKET_CONTRACT,
    functionName: 'get_stats',
    args: [],
  });
  const stats = JSON.parse(statsRaw || '{}');
  console.log('Current Market Count:', stats.market_count);

  if (Number(stats.market_count) > 0) {
    console.log('Markets already exist on-chain. Querying market 1...');
    const m1 = await client.readContract({
      address: MARKET_CONTRACT,
      functionName: 'get_market',
      args: ['1'],
    });
    console.log('Market 1:', m1);
    return;
  }

  console.log('\nCompiling initial seed market on StudioNet...');
  const question = 'Will Ethereum trade at or above $4,000 USD before December 31, 2026?';
  const closeTime = Math.floor(new Date('2026-12-31T23:59:59Z').getTime() / 1000);
  const seedLiquidityWei = '5000000000000000000'; // 5 GEN seed liquidity
  const sourcesCsv = 'coingecko.com,coinmarketcap.com,binance.com';
  // 5 GEN bond + 5 GEN initial liquidity = 10 GEN
  const totalValueWei = 10000000000000000000n;

  console.log('Submitting compile_market transaction to GenLayer validators...');
  const txHash = await client.writeContract({
    address: MARKET_CONTRACT,
    functionName: 'compile_market',
    args: [question, closeTime, seedLiquidityWei, sourcesCsv],
    value: totalValueWei,
  });

  console.log('Transaction sent:', txHash);
  console.log('Waiting for validator consensus receipt...');

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: 'ACCEPTED',
    interval: 3000,
    retries: 60,
  });

  console.log('✓ Receipt received!');
  console.log('Transaction status:', receipt?.status);

  // Verify market count after compilation
  const updatedStats = JSON.parse(await client.readContract({
    address: MARKET_CONTRACT,
    functionName: 'get_stats',
    args: [],
  }));
  console.log('Updated Market Count:', updatedStats.market_count);
}

main().catch((err) => {
  console.error('Seed market failed:', err);
  process.exit(1);
});
