const SCRIPT_URL = process.env.GOOGLE_SCRIPT_WEBAPP;

export default async function handler(req, res) {
  if (!SCRIPT_URL) 
    return res.status(500).json({ ok: false, error: "Missing GOOGLE_SCRIPT_WEBAPP" });

  const { mode, sellerCode, email, password, phone, authCode } = req.body || {};
  if (!mode || !sellerCode || !password)
    return res.status(400).json({ ok: false, error: "Missing fields" });

  try {
    if (mode === "signup") {
      // Signup → save to sellers sheet
      const payload = { mode: "sellerSignup", sellerCode, email, password, phone, authCode };
      const r = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (mode === "login") {
      // Login → verify from sellers sheet
      const qs = new URLSearchParams({ mode: "sellerLogin", sellerCode, password });
      const r = await fetch(`${SCRIPT_URL}?${qs}`);
      const data = await r.json();
      return res.status(200).json(data);
    }

    return res.status(400).json({ ok: false, error: "Invalid mode" });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
}
