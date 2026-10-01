import { chains, createClient, createAccount } from 'genlayer-js';

// StudioNet constants
export const RPC_URL = 'https://studio.genlayer.com/api';
export const CHAIN_ID = 61999;

export const CONTRACTS = {
  charter: '0xBfB34B0b1dCa954823fBbefBAc815c4136d815e0',
  market: '0xe143684F1f1fC777d79401C7C26b2123A1c51fe1',
};

export const DEFAULT_BONDS = {
  authorBondWei: '5000000000000000000', // 5 GEN
  challengeBondWei: '10000000000000000000', // 10 GEN
  appealBondWei: '25000000000000000000', // 25 GEN
  keeperBountyWei: '1000000000000000000', // 1 GEN
};

/**
 * Creates a GenLayer client for reading on-chain state directly.
 */
export function getReadOnlyClient() {
  return createClient({
    chain: chains.studionet,
    endpoint: RPC_URL,
  });
}

/**
 * Formats wei to human-readable GEN string.
 */
export function formatGen(weiStr, decimals = 4) {
  if (!weiStr) return '0.00';
  try {
    const wei = BigInt(weiStr.toString().split('.')[0]);
    const divisor = 10n ** 18n;
    const whole = wei / divisor;
    const remainder = wei % divisor;
    const remainderStr = remainder.toString().padStart(18, '0');
    const frac = remainderStr.slice(0, decimals);
    return `${whole}.${frac}`;
  } catch (e) {
    return '0.00';
  }
}

/**
 * Parses GEN float string to wei string.
 */
export function parseGenToWei(genStr) {
  if (!genStr || isNaN(parseFloat(genStr))) return '0';
  const parts = genStr.toString().trim().split('.');
  const whole = BigInt(parts[0] || '0');
  let fracStr = parts[1] || '';
  if (fracStr.length > 18) {
    fracStr = fracStr.slice(0, 18);
  } else {
    fracStr = fracStr.padEnd(18, '0');
  }
  const frac = BigInt(fracStr);
  return (whole * 10n ** 18n + frac).toString();
}

/**
 * Calculates probability / implied price in percent from basis points (bps).
 */
export function bpsToPercent(bps) {
  if (bps === undefined || bps === null) return '0.0%';
  return `${(Number(bps) / 100).toFixed(1)}%`;
}

/**
 * Formats Unix timestamp to document-style date string.
 */
export function formatDateTime(ts) {
  if (!ts) return 'Not set';
  const num = Number(ts) * 1000;
  return new Date(num).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  });
}
