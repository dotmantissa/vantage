/**
 * deploy/deploy.mjs
 * 
 * Deploys VantageCharter and VantageMarket to GenLayer StudioNet.
 * Authorizes VantageMarket as a registered precedent writer on VantageCharter.
 * Writes deployed addresses to deployed_contracts.json.
 */

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { setGlobalDispatcher, Agent } from 'undici';
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { chains, createClient, createAccount } from 'genlayer-js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const RPC_URL = process.env.GENLAYER_RPC_URL || 'https://studio.genlayer.com/api';
const DEPLOYER_KEY = process.env.DEPLOYER_KEY;

if (!DEPLOYER_KEY) {
  console.error('ERROR: DEPLOYER_KEY is not defined in .env');
  process.exit(1);
}

const account = createAccount(DEPLOYER_KEY);
const client = createClient({
  chain: chains.studionet,
  endpoint: RPC_URL,
  account,
});

console.log('Deployer Address:', account.address);
console.log('RPC Endpoint:', RPC_URL);

async function getContractAddressFromTx(hash) {
  const tx = await client.getTransaction({ hash });
  return (
    tx?.data?.contract_address ||
    tx?.contract_address ||
    tx?.contractAddress ||
    tx?.to
  );
}

async function deployContract(name, filePath, constructorArgs = [], kwargs = {}) {
  console.log(`\nDeploying ${name} from ${filePath}...`);
  const code = fs.readFileSync(filePath, 'utf-8');

  const txHash = await client.deployContract({
    code,
    args: constructorArgs,
    kwargs,
  });
  console.log(`Transaction sent: ${txHash}`);
  console.log('Waiting for receipt on StudioNet...');

  const receipt = await client.waitForTransactionReceipt({
    hash: txHash,
    status: 'ACCEPTED',
    interval: 3000,
    retries: 100,
  });

  let address = receipt?.contract_address || receipt?.contractAddress || receipt?.data?.contract_address;
  if (!address) {
    address = await getContractAddressFromTx(txHash);
  }

  console.log(`✓ ${name} deployed successfully! Address: ${address}`);
  return { address, receipt, txHash };
}

async function main() {
  try {
    let charterAddress = '0xBfB34B0b1dCa954823fBbefBAc815c4136d815e0';
    let charterTxHash = '0xa22710ffc4ee9c5bd1f84624b3750d563057610d9308c261b6f2e71bb34436eb';

    // Verify existing charter or deploy fresh
    try {
      const activeVersion = await client.readContract({
        address: charterAddress,
        functionName: 'get_active_version',
        args: [],
      });
      console.log(`\nUsing existing active VantageCharter at ${charterAddress} (version ${activeVersion})`);
    } catch {
      console.log('\nDeploying fresh VantageCharter...');
      const charterFile = path.join(rootDir, 'contracts', 'vantage_charter.py');
      const charterDeploy = await deployContract('VantageCharter', charterFile, [
        'api.github.com,api.coingecko.com,www.federalreserve.gov',
        'UTC',
        'VOID',
        2,
        3,
        'VOID_AND_SLASH_AUTHOR',
        86400,
        86400,
        604800,
        50,
        '50000000000000000000',
      ]);
      charterAddress = charterDeploy.address;
      charterTxHash = charterDeploy.txHash;
    }

    // 2. Deploy VantageMarket linked to charterAddress
    const marketFile = path.join(rootDir, 'contracts', 'vantage_market.py');
    const marketDeploy = await deployContract('VantageMarket', marketFile, [
      charterAddress,               // charter_address
      account.address,              // treasury
      200,                          // fee_bps_total (2%)
      120,                          // fee_bps_lp (1.2%)
      40,                           // fee_bps_creator (0.4%)
      40,                           // fee_bps_court (0.4%)
      '5000000000000000000',        // author_bond_wei (5 GEN)
      '10000000000000000000',       // challenge_bond_wei (10 GEN)
      '25000000000000000000',       // appeal_bond_wei (25 GEN)
      '1000000000000000000',        // keeper_bounty_wei (1 GEN)
    ]);

    // 3. Authorize VantageMarket as registrar on VantageCharter
    console.log(`\nAuthorizing VantageMarket (${marketDeploy.address}) as registrar on VantageCharter...`);
    const authTxHash = await client.writeContract({
      address: charterAddress,
      functionName: 'authorize_registrar',
      args: [marketDeploy.address],
    });
    console.log(`Authorization tx sent: ${authTxHash}`);
    await client.waitForTransactionReceipt({
      hash: authTxHash,
      status: 'ACCEPTED',
      interval: 3000,
      retries: 50,
    });
    console.log('✓ VantageMarket authorized as precedent registrar on VantageCharter.');

    // 4. Save deployed contract addresses
    const deploymentRecord = {
      network: 'studionet',
      chainId: 61999,
      rpcUrl: RPC_URL,
      deployer: account.address,
      deployedAt: new Date().toISOString(),
      contracts: {
        VantageCharter: {
          address: charterAddress,
          txHash: charterTxHash,
        },
        VantageMarket: {
          address: marketDeploy.address,
          txHash: marketDeploy.txHash,
        },
      },
    };

    const outPath = path.join(rootDir, 'deployed_contracts.json');
    fs.writeFileSync(outPath, JSON.stringify(deploymentRecord, null, 2));
    console.log(`\n✓ Deployment record saved to ${outPath}`);
    console.log('\n========================================');
    console.log('VANTAGE DEPLOYMENT COMPLETE');
    console.log(`Charter: ${charterAddress}`);
    console.log(`Market:  ${marketDeploy.address}`);
    console.log('========================================\n');
  } catch (err) {
    console.error('\nDeployment failed:', err);
    process.exit(1);
  }
}

main();
