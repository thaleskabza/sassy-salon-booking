// api/subscription.js — /api/subscription?action=checkout|status|webhook|activate-test
import redis from './_redis.js';
import { requireAuth } from './_middleware.js';

const STITCH_TOKEN_URL = 'https://secure.stitch.money/connect/token';
const STITCH_GRAPHQL_URL = 'https://api.stitch.money/graphql';
const STITCH_CLIENT_ID = process.env.STITCH_CLIENT_ID || '';
const STITCH_CLIENT_SECRET = process.env.STITCH_CLIENT_SECRET || '';
// Svix-format secret from the Stitch dashboard webhooks section (whsec_...)
const STITCH_WEBHOOK_SECRET = process.env.STITCH_WEBHOOK_SECRET || '';
// Amount in ZAR decimal string (e.g. "299.00" for R299)
const SUBSCRIPTION_AMOUNT = process.env.SUBSCRIPTION_AMOUNT || '299.00';
const APP_URL = process.env.APP_URL || 'https://sassy-salon-booking.vercel.app';
const SUBSCRIPTION_DAYS = 30;

const CREATE_PAYMENT_MUTATION = `
  mutation CreatePaymentRequest($input: ClientPaymentInitiationRequestCreateInput!) {
    clientPaymentInitiationRequestCreate(input: $input) {
      paymentInitiationRequest {
        id
        url
      }
    }
  }
`;

async function getStitchToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: STITCH_CLIENT_ID,
    client_secret: STITCH_CLIENT_SECRET,
    scope: 'client_paymentrequest',
    audience: 'https://secure.stitch.money/connect/token',
  });

  const res = await fetch(STITCH_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Failed to get Stitch token');
  return data.access_token;
}

async function stitchGql(query, variables, token) {
  const res = await fetch(STITCH_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors?.length) {
    throw new Error(data.errors[0]?.message || 'Stitch GraphQL error');
  }
  return data.data;
}

// Verify Svix webhook signature (https://docs.svix.com/receiving/verifying-payloads/how)
// Secret format: "whsec_<base64-encoded-secret>"
// Headers: svix-id, svix-timestamp, svix-signature (format: "v1,<base64sig>")
async function verifySvixSignature(rawBody, headers, secret) {
  if (!secret) return true; // skip verification if no secret configured (dev only)

  const msgId = headers['svix-id'];
  const msgTimestamp = headers['svix-timestamp'];
  const msgSignature = headers['svix-signature'];

  if (!msgId || !msgTimestamp || !msgSignature) return false;

  // Reject stale webhooks (>5 min)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(msgTimestamp)) > 300) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');
  const toSign = `${msgId}.${msgTimestamp}.${rawBody}`;

  const { createHmac } = await import('crypto');
  const computed = createHmac('sha256', secretBytes).update(toSign).digest('base64');

  // svix-signature may contain multiple space-separated "v1,<sig>" entries
  return msgSignature.split(' ').some((entry) => {
    const [, sig] = entry.split(',');
    return sig === computed;
  });
}

export default async function handler(req, res) {
  const action = req.query.action;

  // ── GET /api/subscription?action=status ──────────────────────────────────
  if (req.method === 'GET' && action === 'status') {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      const sub = await redis.hGetAll(`subscription:${auth.tenantId}`);
      if (!sub || !sub.status) {
        return res.status(200).json({ status: 'none' });
      }
      if (sub.status === 'active' && sub.expires_at && new Date(sub.expires_at) < new Date()) {
        await redis.hSet(`subscription:${auth.tenantId}`, { status: 'expired' });
        return res.status(200).json({ status: 'expired', expires_at: sub.expires_at });
      }
      return res.status(200).json({
        status: sub.status,
        expires_at: sub.expires_at,
        plan: sub.plan || 'monthly',
        amount: sub.amount,
        last_payment_at: sub.last_payment_at,
      });
    } catch (err) {
      console.error('GET /api/subscription?action=status', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // ── POST /api/subscription?action=checkout ────────────────────────────────
  if (req.method === 'POST' && action === 'checkout') {
    const auth = requireAuth(req, res);
    if (!auth) return;

    try {
      if (!STITCH_CLIENT_ID || !STITCH_CLIENT_SECRET) {
        return res.status(503).json({ error: 'Payment gateway not configured' });
      }

      const token = await getStitchToken();

      const result = await stitchGql(
        CREATE_PAYMENT_MUTATION,
        {
          input: {
            amount: { quantity: SUBSCRIPTION_AMOUNT, currency: 'ZAR' },
            // payerReference appears on the payer's bank statement — max 12 chars
            payerReference: 'Sassy Salon',
            // beneficiaryReference appears on your statement — max 20 chars
            beneficiaryReference: 'SassySalon Sub',
            // externalReference is returned as a query param on the Stitch redirect
            externalReference: auth.tenantId,
          },
        },
        token
      );

      const paymentRequest = result?.clientPaymentInitiationRequestCreate?.paymentInitiationRequest;
      if (!paymentRequest?.url) {
        throw new Error('Stitch did not return a payment URL');
      }

      // Store pending request ID so the webhook can be cross-referenced
      const existing = await redis.hGetAll(`subscription:${auth.tenantId}`);
      await redis.hSet(`subscription:${auth.tenantId}`, {
        pending_payment_id: paymentRequest.id,
        status: existing?.status || 'none',
      });

      return res.status(200).json({
        checkoutUrl: paymentRequest.url,
        checkoutId: paymentRequest.id,
      });
    } catch (err) {
      console.error('POST /api/subscription?action=checkout', err);
      return res.status(502).json({ error: err.message || 'Payment error' });
    }
  }

  // ── POST /api/subscription?action=webhook ─────────────────────────────────
  // Stitch sends webhooks via Svix. No auth header — verified via Svix signature.
  // Configure this URL in the Stitch dashboard: <APP_URL>/api/subscription?action=webhook
  //
  // NOTE: Vercel parses the JSON body before this handler runs. The re-stringified
  // body is used for signature verification — this works when Stitch sends compact
  // JSON (which it does via Svix), but for guaranteed correctness configure raw
  // body passthrough (export const config = { api: { bodyParser: false } } for Next.js
  // or a dedicated raw-body middleware for plain Vercel functions).
  if (req.method === 'POST' && action === 'webhook') {
    try {
      const rawBody = JSON.stringify(req.body);
      const valid = await verifySvixSignature(rawBody, req.headers, STITCH_WEBHOOK_SECRET);
      if (!valid) {
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }

      const event = req.body;
      // Stitch webhook payload shape (delivered via Svix):
      // { type: "payment_initiation_request.complete", data: { id, externalReference, state: { __typename }, amount } }
      const paymentData = event?.data ?? event;
      const stateType = paymentData?.state?.__typename;
      const eventType = (event?.type ?? '').toLowerCase();

      const isCompleted =
        stateType === 'PaymentInitiationRequestCompleted' ||
        eventType.includes('complet');

      if (isCompleted) {
        const tenantId = paymentData?.externalReference;
        const paymentId = paymentData?.id;
        const amountQty = paymentData?.amount?.quantity;

        if (!tenantId) {
          console.warn('Stitch webhook missing externalReference', event);
          return res.status(400).json({ error: 'Missing externalReference' });
        }

        const now = new Date();
        const expiresAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);

        await redis.hSet(`subscription:${tenantId}`, {
          status: 'active',
          plan: 'monthly',
          amount: amountQty ? `R${amountQty}` : `R${SUBSCRIPTION_AMOUNT}`,
          currency: 'ZAR',
          last_payment_id: paymentId || '',
          last_payment_at: now.toISOString(),
          started_at: now.toISOString(),
          expires_at: expiresAt.toISOString(),
        });

        console.log(`Subscription activated — tenant: ${tenantId}, expires: ${expiresAt.toISOString()}`);
      }

      return res.status(200).json({ received: true });
    } catch (err) {
      console.error('POST /api/subscription?action=webhook', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }
  }

  // ── POST /api/subscription?action=activate-test ───────────────────────────
  // Dev-only: manually activate a subscription without payment
  if (req.method === 'POST' && action === 'activate-test' && process.env.ALLOW_TEST_ACTIVATION === 'true') {
    const auth = requireAuth(req, res);
    if (!auth) return;

    const now = new Date();
    const expiresAt = new Date(now.getTime() + SUBSCRIPTION_DAYS * 24 * 60 * 60 * 1000);

    await redis.hSet(`subscription:${auth.tenantId}`, {
      status: 'active',
      plan: 'monthly',
      amount: `R${SUBSCRIPTION_AMOUNT}`,
      currency: 'ZAR',
      last_payment_at: now.toISOString(),
      started_at: now.toISOString(),
      expires_at: expiresAt.toISOString(),
    });

    return res.status(200).json({ status: 'active', expires_at: expiresAt.toISOString() });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method Not Allowed' });
}
