import Stripe from 'stripe';

const mode = process.env.STRIPE_MODE || 'live';
const stripe = new Stripe(
  mode === 'live'
    ? process.env.STRIPE_SECRET_KEY_LIVE
    : process.env.STRIPE_SECRET_KEY_TEST
);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { name, email, phone, plan, country } = req.body;

  // Pick correct Price IDs
  const priceLookup = {
    Basic: mode === 'live'
      ? process.env.STRIPE_PRICE_BASIC_LIVE
      : process.env.STRIPE_PRICE_BASIC_TEST,
    Plus: mode === 'live'
      ? process.env.STRIPE_PRICE_PLUS_LIVE
      : process.env.STRIPE_PRICE_PLUS_TEST,
    Pro: mode === 'live'
      ? process.env.STRIPE_PRICE_PRO_LIVE
      : process.env.STRIPE_PRICE_PRO_TEST,
  };

  const priceId = priceLookup[plan];
  if (!priceId) return res.status(400).json({ error: 'Invalid plan selected.' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      customer_email: email,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_SITE_URL}/payment-success-page.html`,
      cancel_url: `${process.env.NEXT_PUBLIC_SITE_URL}/cancel-page.html`,
      metadata: { name, email, phone, country, plan },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe Checkout Error:', err);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).end(JSON.stringify({ error: err.message }));
  }
}
