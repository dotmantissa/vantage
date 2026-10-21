import fs from 'node:fs';
import { chains, createClient, createAccount } from 'genlayer-js';
import {TransactionHashVariant} from 'genlayer-js/types';
import networks from '../../../shared/networks.json' with { type: 'json' };
const sdkNames = {studionet:'studionet',testnet_bradbury:'testnetBradbury',localnet:'localnet'};
export function configuration(env = process.env) {
  const network = env.VANTAGE_NETWORK || networks.defaultNetwork;
  if (!sdkNames[network]) throw new Error('Unknown VANTAGE_NETWORK');
  let addresses = networks.deployments.v2[network] || {};
  const manifest = env.V2_DEPLOYMENT_FILE || 'deployed_v2.json';
  if (fs.existsSync(manifest)) {
    const deployed = JSON.parse(fs.readFileSync(manifest,'utf8'));
    if (deployed.network === network) addresses = deployed.contracts;
  }
  for (const address of Object.values(addresses)) if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid V2 deployment address');
  return {network,...networks.networks[network],contracts:addresses,configured:!!(addresses.market && addresses.charter && addresses.memory),networkLabel:network==='studionet'?'StudioNet preview':network==='testnet_bradbury'?'Bradbury beta':'Local GenLayer',legacy:networks.legacy};
}
export function chainClient(config = configuration(), key) {
  return createClient({chain:chains[sdkNames[config.network]],endpoint:config.rpcUrl,...(key?{account:createAccount(key)}:{})});
}
export const decode = raw => typeof raw === 'string' ? JSON.parse(raw) : raw;
export async function read(method,args=[],contract='market',config=configuration(),finalized=false) {
  if (!config.configured) throw Object.assign(new Error('V2 contracts are not deployed on this network.'),{status:503});
  return decode(await chainClient(config).readContract({address:config.contracts[contract],functionName:method,args,transactionHashVariant:finalized?TransactionHashVariant.LATEST_FINAL:TransactionHashVariant.LATEST_NONFINAL}));
}
