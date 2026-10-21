import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chains } from 'genlayer-js';
const config = JSON.parse(readFileSync(new URL('../../shared/networks.json', import.meta.url)));
test('network manifests match pinned SDK chain identities', () => {
  for (const [name, sdkName] of [['studionet','studionet'], ['testnet_bradbury','testnetBradbury'], ['localnet','localnet']]) {
    assert.equal(config.networks[name].chainId, chains[sdkName].id);
    assert.equal(config.networks[name].rpcUrl, chains[sdkName].rpcUrls.default.http[0]);
  }
});
test('V2 has no fabricated deployment addresses and V1 remains available', () => {
  assert.deepEqual(config.deployments.v2, {});
  assert.match(config.legacy.market, /^0x[0-9a-fA-F]{40}$/);
  assert.match(config.runner, /^py-genlayer:[a-z0-9]{40,}$/);
});
test('large wei strings retain every decimal digit',async()=>{
 const {decode}=await import('../../backend/src/v2/config.js');
 assert.equal(decode('100000000000000000001'),'100000000000000000001');
 assert.deepEqual(decode('{"balance":"100000000000000000001"}'),{balance:'100000000000000000001'});
});
