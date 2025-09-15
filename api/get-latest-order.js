export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const { email } = req.query;
  if (!email) {
    return res.status(400).json({ error: "Missing email" });
  }

  try {
    // Call your Apps Script WebApp with ?mode=lookup&email=...
    const resp = await fetch(`${process.env.GOOGLE_SCRIPT_WEBAPP}?mode=lookup&email=${encodeURIComponent(email)}`);
    const data = await resp.json();

    if (!data || !data.orderNo) {
      return res.status(404).json({ error: "No order found for this email" });
    }

    return res.status(200).json(data);
  } catch (err) {
    console.error("❌ Error fetching latest order:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}
