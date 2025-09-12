import crypto from "crypto";

function generateLicenseKey() {
  return Array.from({ length: 6 }, () =>
    crypto.randomBytes(2).toString("hex").toUpperCase()
  ).join("-");
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method Not Allowed" });
  }

  const { name, email, phone, plan, country, stripePaymentId } = req.body;
  const GOOGLE_SCRIPT_WEBAPP = process.env.GOOGLE_SCRIPT_WEBAPP;

  try {
    // Generate secure random license key
    const licenseKey = generateLicenseKey();

    const today = new Date();
    const startDate = today.toISOString().split("T")[0];
    const endDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000)
      .toISOString()
      .split("T")[0];
    const createdAt = today.toISOString();

    // Send data to Google Apps Script
    await fetch(GOOGLE_SCRIPT_WEBAPP, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        key: licenseKey,          // A
        name,                     // B
        email,                    // C
        phone,                    // D
        country,                  // E
        plan,                     // F
        start: startDate,         // G
        end: endDate,             // H
        stripePaymentId,          // J
        createdAt,                // K
        sessionId: "",            // L
        sessionTime: "",          // M
        notes: ""                 // N
      })
    });

    return res.status(200).json({ message: "Success" });

  } catch (err) {
    console.error("Error saving to sheet:", err);
    return res.status(500).json({ message: "Internal Server Error" });
  }
}
