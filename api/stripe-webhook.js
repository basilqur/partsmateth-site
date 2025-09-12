import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const config = {
  api: {
    bodyParser: false, // Required for raw body
  },
};

import { buffer } from 'micro';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const buf = await buffer(req);
  const sig = req.headers['stripe-signature'];

  let event;

  try {
    event = stripe.webhooks.constructEvent(buf, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed.', err);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const { name, email, phone, plan, country } = session.metadata;

    try {
      // Send data to internal API to save in Google Sheet
      await fetch(`${process.env.NEXT_PUBLIC_SITE_URL || 'https://partsmateth.com'}/api/saveToSheet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          email,
          phone,
          country,
          plan,
          stripePaymentId: session.id // Stripe session ID
        })
      });
    } catch (err) {
      console.error('Failed to call saveToSheet:', err);
    }
  }

  res.json({ received: true });
}