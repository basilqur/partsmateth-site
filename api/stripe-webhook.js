import Stripe from 'stripe';
import { buffer } from 'micro';

export const config = {
  api: {
    bodyParser: false, // Required for raw body
  },
};

const mode = process.env.STRIPE_MODE || 'live';
const stripe = new Stripe(
  mode === 'live'
    ? process.env.STRIPE_SECRET_KEY_LIVE
    : process.env.STRIPE_SECRET_KEY_TEST
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;
  const webhookSecret =
    mode === 'live'
      ? process.env.STRIPE_WEBHOOK_SECRET_LIVE
      : process.env.STRIPE_WEBHOOK_SECRET_TEST;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
  } catch (err) {
    console.error('❌ Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { name, email, phone, plan, country } = session.metadata;

    try {
      // Send data to internal API to save in Google Sheet
      await fetch(`${process.env.NEXT_PUBLIC_SITE_URL}/api/saveToSheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          phone,
          country,
          plan,
          stripePaymentId: session.id, // Stripe session ID
        }),
      });
      console.log(`✅ Saved session ${session.id} to sheet`);
    } catch (err) {
      console.error('❌ Failed to call saveToSheet:', err.message);
    }
  }

  res.json({ received: true });
}
