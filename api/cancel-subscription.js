import Stripe from "stripe";

const APPS_SCRIPT_URL2 = process.env.GOOGLE_SCRIPT_WEBAPP;

function getStripe() {
const mode = (process.env.STRIPE_MODE || "live").toLowerCase();
let key;
if (mode === "live") {
key = process.env.STRIPE_SECRET_KEY_LIVE;
} else {
key = process.env.STRIPE_SECRET_KEY_TEST;
}
if (!key) throw new Error("Missing Stripe secret key env");
return new Stripe(key, { apiVersion: "2024-06-20" });
}

export { getStripe };

async function fetchProfileByKey(key) {
  const qs = new URLSearchParams({ mode: "profileByKey", licenseKey: key });
  const url = `${APPS_SCRIPT_URL2}?${qs.toString()}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Profile lookup failed");
  return r.json();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });
    if (!APPS_SCRIPT_URL2) return res.status(500).json({ ok: false, error: "Missing GOOGLE_SCRIPT_WEBAPP env" });

    const { licenseKey } = req.body || {};
    if (!licenseKey) return res.status(400).json({ ok: false, error: "Missing licenseKey" });

    const profile = await fetchProfileByKey(licenseKey).catch(() => ({}));
    console.log("DEBUG fetched profile:", profile);

    const subId = profile.stripeSubscriptionId || profile.subscriptionId || profile.stripePaymentId || "";
    if (!subId) {
      return res.status(400).json({ ok: false, error: "No recurring subscription for this license", profile });
    }

    const stripe = getStripe();
    const updated = await stripe.subscriptions.update(subId, { cancel_at_period_end: true });
    await fetch(APPS_SCRIPT_URL2, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    mode: "markCancelled",
    licenseKey
  })
});

    return res.status(200).json({ ok: true, subscription: { id: updated.id, cancel_at_period_end: updated.cancel_at_period_end, current_period_end: updated.current_period_end } });
  
} catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Server error" });
  }
}
