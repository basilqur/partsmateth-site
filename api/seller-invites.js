const SCRIPT_URL = process.env.GOOGLE_SCRIPT_WEBAPP;

export default async function handler(req, res) {
  if (!SCRIPT_URL) return res.status(500).json({ ok: false, error: "Missing GOOGLE_SCRIPT_WEBAPP" });

  const { mode, sellerCode, inviteCode, random } = req.body || {};

  try {
    if (mode === "create") {
      const payload = { mode: "sellerInviteCreate", sellerCode, inviteCode, random };
      const r = await fetch(SCRIPT_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await r.json();
      return res.status(200).json(data);
    }

    if (mode === "list") {
      const qs = new URLSearchParams({ mode: "sellerInviteList", sellerCode });
      const r = await fetch(`${SCRIPT_URL}?${qs}`);
      const data = await r.json();
      return res.status(200).json(data);
    }

    res.status(400).json({ ok: false, error: "Invalid mode" });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
}
