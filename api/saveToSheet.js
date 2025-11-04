import crypto from "crypto";

function generateLicenseKey() {
  return Array.from({ length: 6 }, () =>
    crypto.randomBytes(2).toString("hex").toUpperCase()
  ).join("-");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const {
      sheet,
      name,
      email,
      phone,
      country,
      plan,
      message,
      stripePaymentId,
      createdAt,
      invCode,          // ✅ new
      trialUsed,        // ✅ new
    } = req.body;

    // default to licensekeys sheet
    const targetSheet =
      plan?.toLowerCase() === "trial" || trialUsed?.toUpperCase() === "YES"
        ? "trialkeys"
        : (sheet || "licensekeys");

    // license-related values (only for licensekeys sheet)
    let licenseKey = "";
    let startDate = "";
    let endDate = "";
    let created = createdAt || new Date().toISOString();

    licenseKey = generateLicenseKey();
    if (targetSheet === "licensekeys") {
      const today = new Date();
      startDate = today.toISOString().split("T")[0];
      const days = (plan?.toLowerCase() === "trial") ? 7 : 30;   // ✅ trial = 7
      endDate = new Date(today.getTime() + days*24*60*60*1000).toISOString().split("T")[0];
    }

    // payload for Google Apps Script
    const payload = {
      key: licenseKey,      // B
      name,                 // C
      email,                // D
      phone,                // E
      country,              // F
      plan,                 // G
      start: startDate,     // H
      end: endDate,         // I
      stripePaymentId,      // K
      createdAt: created,   // L
      sessionId: "",        // M
      sessionTime: "",      // N
      notes: message || "", // O
      invCode: invCode || "", // P
      trialUsed: trialUsed || (plan?.toLowerCase() === "trial" ? "YES" : "NO"), //Q
    };

    const scriptUrl = process.env.GOOGLE_SCRIPT_WEBAPP;

    const resp = await fetch(
      `${scriptUrl}?mode=save&sheet=${encodeURIComponent(targetSheet)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }
    );

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || data.ok === false) {
      return res.status(400).json({ error: data.error || "Save failed" }); // ✅ propagate
    }

    return res.status(200).json({
      ok: true,
      message: "Success",
      orderNo: data.orderNo || null,
      licenseKey: data.licenseKey || licenseKey || null,
    });
  } catch (err) {
    console.error("❌ Error in saveToSheet:", err);
    return res.status(500).json({ error: err.message });
  }
}