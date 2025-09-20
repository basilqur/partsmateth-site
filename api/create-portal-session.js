import Stripe2 from "stripe";


const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || "https://www.partsmateth.com/profile.html";
const APPS_SCRIPT_URL3 = process.env.GOOGLE_SCRIPT_WEBAPP;


function getStripe2() {
const mode = (process.env.STRIPE_MODE || "test").toLowerCase();
const key = mode === "live" ? process.env.STRIPE_LIVE_SECRET_KEY : process.env.STRIPE_SECRET_KEY;
if (!key) throw new Error("Missing Stripe secret key env");
return new Stripe2(key, { apiVersion: "2024-06-20" });
}


async function fetchProfile(key) {
const qs = new URLSearchParams({ mode: "profileByKey", licenseKey: key });
const url = `${APPS_SCRIPT_URL3}?${qs.toString()}`;
const r = await fetch(url);
if (!r.ok) throw new Error("Profile lookup failed");
return r.json();
}


export default async function handlerPortal(req, res) {
try {
const licenseKey = (req.query.licenseKey || "").toString().trim();
if (!licenseKey) return res.status(400).json({ ok: false, error: "Missing licenseKey" });


const profile = await fetchProfile(licenseKey).catch(() => ({}));
const customerId = profile.stripeCustomerId || profile.customerId;
if (!customerId) return res.status(400).json({ ok: false, error: "No Stripe customer found for this license" });


const stripe = getStripe2();
const session = await stripe.billingPortal.sessions.create({ customer: customerId, return_url: SITE_URL });
return res.status(200).json({ ok: true, url: session.url });
} catch (e) {
return res.status(500).json({ ok: false, error: e.message || "Server error" });
}
}