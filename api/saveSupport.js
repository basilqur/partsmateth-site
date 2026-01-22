import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const { name, email, phone, country, message } = req.body;

    // Basic validation
    if (!name || !email || !message) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // ---- 1) SAVE TO GOOGLE SHEET ----
    const scriptUrl = process.env.GOOGLE_SCRIPT_WEBAPP;

    const resp = await fetch(
      `${scriptUrl}?mode=save&sheetName=web_support_messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetName: "web_support_messages",
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
      return res.status(400).json({
        error: data.error || "Failed to save support message",
      });
    }

    const orderNo = data.orderNo || "";

    // ---- 2) EMAIL TO SUPPORT ----
    await resend.emails.send({
      from: "PartsMateTH Support <support@partsmateth.com>",
      to: ["support@partsmateth.com"],
      subject: `New Support Message ${orderNo}`,
      html: `
        <h2>New Support Message</h2>
        <p><b>Order No:</b> ${orderNo || "-"}</p>
        <p><b>Name:</b> ${name}</p>
        <p><b>Email:</b> ${email}</p>
        <p><b>Phone:</b> ${phone || "-"}</p>
        <p><b>Country:</b> ${country || "-"}</p>
        <p><b>Message:</b><br/>${message}</p>
      `,
    });

    // ---- 3) AUTO-REPLY TO USER ----
    await resend.emails.send({
      from: "PartsMateTH Support <support@partsmateth.com>",
      to: [email],
      subject: "We received your message",
      html: `
        <p>Hi ${name},</p>
        <p>✅ Thank you for contacting <b>PartsMateTH</b>.</p>
        <p>Your message has been received and our support team will get back to you shortly.</p>
        <p><b>Reference No:</b> ${orderNo || "-"}</p>
        <br/>
        <p>Best regards,<br/>PartsMateTH Support</p>
      `,
    });

    return res.status(200).json({
      ok: true,
      message: "Support message saved and emails sent",
      orderNo,
    });
  } catch (err) {
    console.error("❌ Error in saveSupport:", err);
    return res.status(500).json({ error: err.message });
  }
}
