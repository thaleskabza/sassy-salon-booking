// api/_middleware.js — auth + subscription guards
import { extractToken, verifyToken } from './_auth.js';
import redis from './_redis.js';

// Verify JWT and return { tenantId, email } or send 401
export function requireAuth(req, res) {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required' });
    return null;
  }
  const payload = verifyToken(token);
  if (!payload || !payload.tenantId) {
    res.status(401).json({ error: 'Invalid or expired token' });
    return null;
  }
  return payload;
}

// Check subscription is active for this tenant; returns true or sends 402
export async function requireSubscription(res, tenantId) {
  const sub = await redis.hGetAll(`subscription:${tenantId}`);
  if (!sub || sub.status !== 'active') {
    res.status(402).json({
      error: 'Subscription required',
      code: 'SUBSCRIPTION_INACTIVE'
    });
    return false;
  }
  // check expiry
  if (sub.expires_at && new Date(sub.expires_at) < new Date()) {
    await redis.hSet(`subscription:${tenantId}`, { status: 'expired' });
    res.status(402).json({
      error: 'Subscription expired',
      code: 'SUBSCRIPTION_EXPIRED'
    });
    return false;
  }
  return true;
}

// Namespace a Redis key for a specific tenant
export function tk(tenantId, key) {
  return `t:${tenantId}:${key}`;
}
