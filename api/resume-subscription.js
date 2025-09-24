import { getStripe } from "./cancel-subscription.js";  // reuse same helper

const APPS_SCRIPT_URL = process.env.GOOGLE_SCRIPT_WEBAPP;

async function fetchProfileByKey(key) {
  const qs = new URLSearchParams({ mode: "profileByKey", licenseKey: key });
  const url = `${APPS_SCRIPT_URL}?${qs.toString()}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error("Profile lookup failed");
  return r.json();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST")
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    if (!APPS_SCRIPT_URL)
      return res.status(500).json({ ok: false, error: "Missing GOOGLE_SCRIPT_WEBAPP env" });

    const { licenseKey } = req.body || {};
    if (!licenseKey)
      return res.status(400).json({ ok: false, error: "Missing licenseKey" });

    const profile = await fetchProfileByKey(licenseKey).catch(() => ({}));
    const subId = profile.stripeSubscriptionId || profile.subscriptionId || profile.stripePaymentId || "";
    if (!subId)
      return res.status(400).json({ ok: false, error: "No subscription found for this license" });

    const stripe = getStripe();
    const updated = await stripe.subscriptions.update(subId, { cancel_at_period_end: false });

    // Mark resumed in Apps Script (clear Notes)
    await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        mode: "markResumed",
        licenseKey
      })
    });

    return res.status(200).json({
      ok: true,
      subscription: {
        id: updated.id,
        cancel_at_period_end: updated.cancel_at_period_end,
        current_period_end: updated.current_period_end
      }
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Server error" });
  }
}
