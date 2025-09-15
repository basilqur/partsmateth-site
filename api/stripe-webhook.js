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
    const { name, email, phone, plan, country } = session.metadata;
    const subscriptionId = session.subscription;

    try {
      // Call saveToSheet and capture response (orderNo + licenseKey)
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
        }),
      });

      const data = await resp.json();
      console.log(`✅ Saved subscription ${subscriptionId} with order ${data.orderNo}`);

      // Redirect user to success page with query params
      // (Stripe Checkout handles redirect using success_url, but user-facing page needs these values)
      // For now, just log the intended URL:
      console.log(
        `👉 Success Page URL: ${process.env.NEXT_PUBLIC_SITE_URL}/payment-success-page.html?orderNo=${encodeURIComponent(data.orderNo)}&licenseKey=${encodeURIComponent(data.licenseKey)}`
      );
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