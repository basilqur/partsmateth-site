import { Resend } from "resend";
import crypto from "crypto";

const resend = new Resend(process.env.RESEND_API_KEY);

/* ------------------------------------------------------------------ *
 *  Bot / spam protection helpers
 * ------------------------------------------------------------------ */

// Allowed origins that may submit the contact form.
const ALLOWED_HOSTS = [
  "partsmateth.com",
  "www.partsmateth.com",
];

// Proof-of-work difficulty: required leading hex zeros of sha256(`${ts}.${nonce}`)
const POW_PREFIX = "000";          // 3 hex zeros: trivial in a browser, requires running JS
const POW_MAX_AGE_MS = 15 * 60_000; // token valid for 15 minutes
const POW_MIN_AGE_MS = 2_500;       // must have spent at least ~2.5s on the page

// Simple in-memory rate limiter (per warm serverless instance)
const RATE = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const entry = RATE.get(key);
  if (!entry || now > entry.reset) {
    RATE.set(key, { count: 1, reset: now + windowMs });
    return false;
  }
  entry.count += 1;
  return entry.count > max;
}

function sha256Hex(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

function getClientIp(req) {
  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string" && xff.length) return xff.split(",")[0].trim();
  return req.socket?.remoteAddress || "unknown";
}

function looksLikeEmail(v) {
  return typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
}

function phoneDigits(v) {
  return (typeof v === "string" ? v : "").replace(/\D/g, "");
}

function looksLikeRealName(v) {
  if (typeof v !== "string") return false;
  const t = v.trim();
  if (t.length < 2 || t.length > 80) return false;
  if (/https?:\/\/|www\.|<|>/i.test(t)) return false;      // urls / html
  return /[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u4e00-\u9fff]/.test(t);
}

// Common spam signatures seen in bot submissions
const SPAM_PATTERNS = [
  /\b(viagra|cialis|casino|porn|crypto airdrop|forex|loan offer|seo services|backlinks?)\b/i,
  /\b(bitcoin|btc|usdt|investment opportunity|earn \$?\d+)\b/i,
  /\[url=|\[link=|<a\s+href/i,
  /(https?:\/\/[^\s]+){3,}/i,            // 3+ links
];

function looksLikeSpamMessage(v) {
  const t = (typeof v === "string" ? v : "").trim();
  if (t.length < 5 || t.length > 5000) return true;
  if (SPAM_PATTERNS.some((re) => re.test(t))) return true;
  // mostly links / no letters
  if (!/[a-zA-Z\u00C0-\u024F\u0400-\u04FF\u0600-\u06FF\u0E00-\u0E7F\u4e00-\u9fff]/.test(t)) return true;
  return false;
}

function validPow(pow) {
  if (!pow || typeof pow !== "object") return false;
  const ts = Number(pow.ts);
  const nonce = String(pow.nonce ?? "");
  if (!Number.isFinite(ts) || !nonce) return false;
  const age = Date.now() - ts;
  if (age < POW_MIN_AGE_MS || age > POW_MAX_AGE_MS) return false;
  return sha256Hex(`${ts}.${nonce}`).startsWith(POW_PREFIX);
}

function originAllowed(req) {
  const origin = req.headers.origin || "";
  const referer = req.headers.referer || "";
  const src = origin || referer;
  if (!src) return false; // direct bot POSTs usually have neither
  try {
    const host = new URL(src).hostname.toLowerCase();
    return ALLOWED_HOSTS.includes(host);
  } catch {
    return false;
  }
}

// Respond as success so bots get no useful signal that they were blocked.
function silentOk(res) {
  return res.status(200).json({ ok: true, message: "Support message received" });
}

/* ------------------------------------------------------------------ */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  try {
    const body = req.body || {};
    const { name, email, phone, country, message, company, pow } = body;

    // 1) Honeypot — only bots fill the hidden "company" field
    if (typeof company === "string" && company.trim() !== "") {
      return silentOk(res);
    }

    // 2) Origin / Referer must be our site (blocks direct script POSTs)
    if (!originAllowed(req)) {
      return silentOk(res);
    }

    // 3) Proof-of-work token must be valid (blocks clients that don't run JS)
    if (!validPow(pow)) {
      return silentOk(res);
    }

    // 4) Field-level validation
    if (!looksLikeRealName(name)) return silentOk(res);
    if (!looksLikeEmail(email)) return silentOk(res);
    if (phone && phoneDigits(phone).length < 6) return silentOk(res);
    if (looksLikeSpamMessage(message)) return silentOk(res);

    // 5) Rate limiting (per IP and per email)
    const ip = getClientIp(req);
    if (rateLimited(`ip:${ip}`, 5, 60 * 60_000)) return silentOk(res);
    if (rateLimited(`em:${String(email).toLowerCase()}`, 3, 60 * 60_000)) return silentOk(res);

    /* ---- 1) SAVE TO GOOGLE SHEET ---- */
    const scriptUrl = process.env.GOOGLE_SCRIPT_WEBAPP;

    const resp = await fetch(
      `${scriptUrl}?mode=save&sheet=web_support_messages`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheet: "web_support_messages",
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

    /* ---- 2) EMAIL TO SUPPORT ---- */
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

    /* ---- 3) AUTO-REPLY TO USER ---- */
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