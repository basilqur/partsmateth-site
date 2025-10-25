import Stripe from 'stripe';

export const config = {
  api: { bodyParser: false },
};

const mode = process.env.STRIPE_MODE || 'live';
const stripe = new Stripe(
  mode === 'live'
    ? process.env.STRIPE_SECRET_KEY_LIVE
    : process.env.STRIPE_SECRET_KEY_TEST
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const rawBody = await getRawBody(req);
  const sig = req.headers['stripe-signature'];

  let event;
  const webhookSecret =
    mode === 'live'
      ? process.env.STRIPE_WEBHOOK_SECRET_LIVE
      : process.env.STRIPE_WEBHOOK_SECRET_TEST;

  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { name, email, phone, country, plan, invCode } = session.metadata; // ✅ added invCode
    const subscriptionId = session.subscription;

    try {
      // ✅ Call saveToSheet with invCode + trialUsed flags
      const resp = await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/saveToSheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          phone,
          country,
          plan,
          stripePaymentId: subscriptionId,
          createdAt: new Date().toISOString(),
          invCode: invCode || '', // ✅ pass invite code
          trialUsed: 'NO',       // ✅ mark as paid plan
        }),
      });

      const data = await resp.json();
      console.log(`✅ Saved subscription ${subscriptionId} with order ${data.orderNo}`);
      console.log(`👉 Success Page: ${process.env.NEXT_PUBLIC_SITE_URL}/payment-success-page.html?orderNo=${encodeURIComponent(data.orderNo)}&licenseKey=${encodeURIComponent(data.licenseKey)}&plan=${encodeURIComponent(plan)}&invCode=${encodeURIComponent(invCode || '')}`);
    } catch (err) {
      console.error('❌ Failed to call saveToSheet:', err.message);
    }
  }

  res.json({ received: true });
}

// Helper to get raw body for signature validation
function getRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}