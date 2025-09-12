import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { name, email, phone, plan, country } = req.body;

  const priceLookup = {
    Basic: 'price_1RfLkGHI32OfAU2tsBfXhRI3',
    Plus: 'price_1RfM4VHI32OfAU2tz0wVWGKg',
    Pro: 'price_1RfM6OHI32OfAU2tq2ESe6tx',
  };

  const priceId = priceLookup[plan];
  if (!priceId) return res.status(400).json({ error: 'Invalid plan selected.' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription', // recurring pricing
      customer_email: email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: 'https://www.partsmateth.com/success', // ✅ update to your domain
      cancel_url: 'https://www.partsmateth.com/cancel',
      metadata: {
        name,
        email,
        phone,
        country,
        plan,
      },
    });

    res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('Stripe Checkout Error:', err);
    res.setHeader('Content-Type', 'application/json');
    res.status(500).end(JSON.stringify({ error: err.message }));
  }
}