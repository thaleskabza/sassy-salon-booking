// api/subscription.js — /api/subscription?action=checkout|status|webhook
import redis from './_redis.js';
import { requireAuth } from './_middleware.js';

const YOCO_API = 'https://payments.yoco.com/api';
const YOCO_SECRET_KEY = process.env.YOCO_SECRET_KEY || '';
// Amount in ZAR cents (R299 = 29900)
const SUBSCRIPTION_AMOUNT_CENTS = Number(process.env.SUBSCRIPTION_AMOUNT_CENTS || 29900);
const APP_URL = process.env.APP_URL || 'https://sassy-salon-booking.vercel.app';
const SUBSCRIPTION_DAYS = 30;

async function yocoFetch(path, options = {}) {
  const url = `${YOCO_API}${path}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${YOCO_SECRET_KEY}`,
      ...(options.headers || {})
    }
  });
  const body = await res.json();
  if (!res.ok) throw Object.assign(new Error(body.errorCode || 'Yoco error'), { yoco: body });
  return body;
}

export default async function handler(req, res) {
  const action = req.query.action;

  // ── GET /api/subscription?action=status ─────────────────────────────────
  if (req.method === 'GET' && action === 'status') {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      const sub = await redis.hGetAll(`subscription:${auth.tenantId}`);
      if (!sub || !sub.status) {
        return res.status(200).json({ status: 'none' });
      }
      // auto-expire
      if (sub.status === 'active' && sub.expires_at && new Date(sub.expires_at) < new Date()) {
        await redis.hSet(`subscription:${auth.tenantId}`, { status: 'expired' });
        return res.status(200).json({ status: 'expired', expires_at: sub.expires_at });
      }
      return res.status(200).json({
        status: sub.status,
        expires_at: sub.expires_at,
        plan: sub.plan || 'monthly',
        amount: sub.amount,
        last_payment_at: sub.last_payment_at
      });
    } catch (err) {
      console.error('GET /api/subscription?action=status', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // ── POST /api/subscription?action=checkout ───────────────────────────────
  if (req.method === 'POST' && action === 'checkout') {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      if (!YOCO_SECRET_KEY) {
        return res.status(503).json({ error: 'Payment gateway not configured' });
      }

      const checkout = await yocoFetch('/checkouts', {
        method: 'POST',
        body: JSON.stringify({
          amount: SUBSCRIPTION_AMOUNT_CENTS,
          currency: 'ZAR',
          cancelUrl: `${APP_URL}/subscribe.html?cancelled=true`,
          successUrl: `${APP_URL}/subscribe.html?success=true`,
          metadata: { tenantId: auth.tenantId, plan: 'monthly' }
        })
      });

      // store the pending checkout so webhook can match it
      await redis.hSet(`subscription:${auth.tenantId}`, {
        pending_checkout_id: checkout.id,
        status: sub_current_status(await redis.hGetAll(`subscription:${auth.tenantId}`))
      });

      return res.status(200).json({ checkoutUrl: checkout.redirectUrl, checkoutId: checkout.id });
    } catch (err) {
      console.error('POST /api/subscription?action=checkout', err);
      const msg = err.yoco?.displayMessage || err.message || 'Payment error';
      return res.status(502).json({ error: msg });
    }
  }

  // ── POST /api/subscription?action=webhook ────────────────────────────────
  // Yoco sends POST to this URL on payment events. No auth header — it uses webhook secret.
  if (req.method === 'POST' && action === 'webhook') {
    try {
      const webhookSecret = process.env.YOCO_WEBHOOK_SECRET || '';
      // Yoco signs payloads with X-Yoco-Signature header
      if (webhookSecret) {
        const sig = req.headers['x-yoco-signature'] || '';
        const crypto = await import('crypto');
        const body = JSON.stringify(req.body);
        const expected = crypto.createHmac('sha256', webhookSecret).update(body).digest('hex');
        if (sig !== expected) {
          return res.status(401).json({ error: 'Invalid webhook signature' });
        }
      }

      const event = req.body;
      const eventType = event?.type;

      if (eventType === 'payment.succeeded') {
        const tenantId = event?.payload?.metadata?.tenantId;
        const paymentId = event?.payload?.id;
        const amount = event?.payload?.amount;

        if (!tenantId) {
          return res.status(400).json({ error: 'Missing tenantId in metadata' });
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);

        await redis.hSet(`subscription:${tenantId}`, {
          status: 'active',
          plan: 'monthly',
          amount: String(amount || SUBSCRIPTION_AMOUNT_CENTS),
          currency: 'ZAR',
          last_payment_id: paymentId || '',
          last_payment_at: now.toISOString(),
          started_at: now.toISOString(),
          expires_at: expiresAt.toISOString()
        });

        console.log(`Subscription activated for tenant ${tenantId}, expires ${expiresAt.toISOString()}`);
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('POST /api/subscription?action=webhook', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // ── POST /api/subscription?action=activate-test ─────────────────────────
  // Dev-only: manually activate subscription (remove before prod or guard with env flag)
  if (req.method === 'POST' && action === 'activate-test' && process.env.ALLOW_TEST_ACTIVATION === 'true') {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);

    await redis.hSet(`subscription:${auth.tenantId}`, {
      status: 'active',
      plan: 'monthly',
      amount: String(SUBSCRIPTION_AMOUNT_CENTS),
      currency: 'ZAR',
      last_payment_at: now.toISOString(),
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString()
    });

    return res.status(200).json({ status: 'active', expires_at: expiresAt.toISOString() });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}

function sub_current_status(sub) {
  if (!sub || !sub.status) return 'none';
  return sub.status;
}
