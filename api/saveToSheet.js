export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).send('Method Not Allowed');
  }

  const scriptURL = "https://script.google.com/macros/s/AKfycbx5gmjnb2SKjn1ZAKB_GqXbAXXaclCxCZwCYkqo_zxj7OfOaD6yxyCGUkGmUoMzxjwk/exec";

  try {
    const googleRes = await fetch(scriptURL, {
      method: 'POST',
      body: JSON.stringify(req.body),
      headers: { 'Content-Type': 'application/json' }
    });

    const text = await googleRes.text();
    res.status(200).send(text);
  } catch (err) {
    console.error(err);
    res.status(500).send("Proxy Error: " + err.message);
  }
}
