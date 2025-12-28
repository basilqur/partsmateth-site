export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { name, email, phone, country, message } = req.body;

    // basic validation
    if (!name || !email || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const scriptUrl = process.env.GOOGLE_SCRIPT_WEBAPP;

    const resp = await fetch(
      `${scriptUrl}?mode=save&sheet=web_support_messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          phone,
          country,
          message,
        }),
      }
    );

    const data = await resp.json().catch(() => ({}));

    if (!resp.ok || data.ok === false) {
      return res.status(400).json({ error: data.error || "Save failed" });
    }

    return res.status(200).json({
      ok: true,
      message: "Support message saved",
      orderNo: data.orderNo || null,
    });
  } catch (err) {
    console.error("❌ Error in saveSupport:", err);
    return res.status(500).json({ error: err.message });
  }
}
