import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end('Method Not Allowed');

  const { name, email, phone, plan } = req.body;

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
       mode: 'subscription',  // ✅ This matches your recurring pricing setup
      customer_email: email,
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: 'https://partsmate.com/success', // replace with your real URL
      cancel_url: 'https://partsmate.com/cancel',   // replace with your real URL
      metadata: {
        name,
        email,
        phone,
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
