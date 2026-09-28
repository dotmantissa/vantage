import { PrivyClient } from '@privy-io/server-auth';
import dotenv from 'dotenv';

dotenv.config();

const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const PRIVY_APP_SECRET = process.env.PRIVY_APP_SECRET;

let privy = null;
if (PRIVY_APP_ID && PRIVY_APP_SECRET) {
  privy = new PrivyClient(PRIVY_APP_ID, PRIVY_APP_SECRET);
} else {
  console.warn('WARN: Privy credentials not fully set. Auth middleware will operate in permissive mode.');
}

/**
 * Extracts and verifies Privy token from the Authorization header.
 */
export async function verifyPrivyToken(authHeader) {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;

  if (!privy) {
    // If running in development without secrets, simulate a demo user
    return {
      userId: 'did:privy:demo_user',
      address: '0xbc1399c55538ec034d4da550c03c34ae0c357f53',
      email: 'demo@vantage.market',
    };
  }

  try {
    const verifiedClaims = await privy.verifyAuthToken(token);
    const user = await privy.getUser(verifiedClaims.userId);
    const ethAddress = user.wallet?.address || user.linkedAccounts?.find(a => a.type === 'wallet')?.address || null;
    const email = user.email?.address || user.linkedAccounts?.find(a => a.type === 'email')?.address || null;

    return {
      userId: verifiedClaims.userId,
      address: ethAddress ? ethAddress.toLowerCase() : null,
      email,
      raw: user,
    };
  } catch (err) {
    console.error('Privy verification failed:', err.message);
    return null;
  }
}

/**
 * Express middleware requiring a valid Privy auth token.
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  const user = await verifyPrivyToken(authHeader);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized: valid Privy token required' });
  }
  req.user = user;
  next();
}

/**
 * Express middleware that attaches user if token is present, but doesn't block if missing.
 */
export async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    req.user = await verifyPrivyToken(authHeader);
  } else {
    req.user = null;
  }
  next();
}
