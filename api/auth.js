// api/auth.js — /api/auth?action=register|login|me
import bcrypt from 'bcryptjs';
import redis from './_redis.js';
import { signToken, extractToken, verifyToken } from './_auth.js';
import { nanoid } from 'nanoid';

export default async function handler(req, res) {
  const action = req.query.action;

  // ── POST /api/auth?action=register ──────────────────────────────────────
  if (req.method === 'POST' && action === 'register') {
    try {
      const { email, password, salon_name, owner_name } = req.body || {};

      if (!email || !password || !salon_name || !owner_name) {
        return res.status(400).json({
          error: 'email, password, salon_name, and owner_name are required'
        });
      }

      if (password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters' });
      }

      // Check email not already registered
      const existing = await redis.hGet('tenants:by-email', email.toLowerCase());
      if (existing) {
        return res.status(409).json({ error: 'Email already registered' });
      }

      const tenantId = `tenant-${nanoid(10)}`;
      const password_hash = await bcrypt.hash(password, 10);
      const now = new Date().toISOString();

      await redis.hSet(`tenant:${tenantId}`, {
        id: tenantId,
        email: email.toLowerCase(),
        password_hash,
        salon_name,
        owner_name,
        created_at: now
      });

      // email → tenantId index
      await redis.hSet('tenants:by-email', email.toLowerCase(), tenantId);
      await redis.sAdd('tenants:all', tenantId);

      const token = signToken({ tenantId, email: email.toLowerCase() });

      return res.status(201).json({
        token,
        tenant: { id: tenantId, email: email.toLowerCase(), salon_name, owner_name }
      });
    } catch (err) {
      console.error('POST /api/auth?action=register', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // ── POST /api/auth?action=login ──────────────────────────────────────────
  if (req.method === 'POST' && action === 'login') {
    try {
      const { email, password } = req.body || {};

      if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
      }

      const tenantId = await redis.hGet('tenants:by-email', email.toLowerCase());
      if (!tenantId) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const tenant = await redis.hGetAll(`tenant:${tenantId}`);
      if (!tenant || !tenant.password_hash) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const valid = await bcrypt.compare(password, tenant.password_hash);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid credentials' });
      }

      const token = signToken({ tenantId, email: tenant.email });

      return res.status(200).json({
        token,
        tenant: {
          id: tenantId,
          email: tenant.email,
          salon_name: tenant.salon_name,
          owner_name: tenant.owner_name
        }
      });
    } catch (err) {
      console.error('POST /api/auth?action=login', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // ── GET /api/auth?action=me ──────────────────────────────────────────────
  if (req.method === 'GET' && action === 'me') {
    try {
      const token = extractToken(req);
      if (!token) return res.status(401).json({ error: 'Not authenticated' });

      const payload = verifyToken(token);
      if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

      const tenant = await redis.hGetAll(`tenant:${payload.tenantId}`);
      if (!tenant || !tenant.id) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // Check subscription status
      const sub = await redis.hGetAll(`subscription:${payload.tenantId}`);

      return res.status(200).json({
        tenant: {
          id: tenant.id,
          email: tenant.email,
          salon_name: tenant.salon_name,
          owner_name: tenant.owner_name,
          created_at: tenant.created_at
        },
        subscription: sub && sub.status
          ? {
              status: sub.status,
              expires_at: sub.expires_at,
              plan: sub.plan || 'monthly'
            }
          : { status: 'none' }
      });
    } catch (err) {
      console.error('GET /api/auth?action=me', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
