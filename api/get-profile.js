import fetch from "node-fetch";


const APPS_SCRIPT_URL = process.env.GOOGLE_SCRIPT_WEBAPP; // e.g. https://script.google.com/macros/s/XXXXX/exec


async function callAppsScript(params) {
const qs = new URLSearchParams(params);
const url = `${APPS_SCRIPT_URL}?${qs.toString()}`;
const r = await fetch(url, { method: "GET", headers: { "cache-control": "no-store" } });
if (!r.ok) throw new Error(`Apps Script error ${r.status}`);
return r.json();
}


export default async function handler(req, res) {
try {
if (!APPS_SCRIPT_URL) return res.status(500).json({ ok: false, error: "Missing GOOGLE_SCRIPT_WEBAPP env" });


const key = (req.query.key || req.query.licenseKey || "").toString().trim();
if (!key) return res.status(400).json({ ok: false, error: "Missing license key" });


// Try a few modes to stay compatible with your existing Apps Script
const attempts = [
{ mode: "profileByKey", licenseKey: key },
{ mode: "lookupByKey", licenseKey: key },
{ mode: "profile", licenseKey: key },
{ mode: "lookup", licenseKey: key }, // some scripts use a generic mode name
];


let data = null;
for (const p of attempts) {
try { data = await callAppsScript(p); } catch { data = null; }
if (data && (data.ok || data.licenseKey || data.email)) break;
}


if (!data) return res.status(404).json({ ok: false, error: "Profile not found" });


// Normalize payload keys
const out = {
ok: true,
name: data.name || data.fullName || "",
email: data.email || "",
phone: data.phone || data.phoneNumber || "",
country: data.country || "",
plan: data.plan || data.tier || "",
status: data.status || "",
start: data.start || data.startDate || "",
end: data.end || data.endDate || "",
orderNo: data.orderNo || data.order || "",
licenseKey: data.licenseKey || key,
stripeCustomerId: data.stripeCustomerId || data.customerId || "",
stripeSubscriptionId: data.stripeSubscriptionId || data.subscriptionId || "",
stripePaymentId: data.stripePaymentId || data.paymentIntentId || "",
customerPortalUrl: data.customerPortalUrl || "",
};


return res.status(200).json(out);
} catch (e) {
return res.status(500).json({ ok: false, error: e.message || "Server error" });
}
}