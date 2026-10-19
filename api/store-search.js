// Parts.Resource (Tradesoft) price & availability search for PartsMate.
//
// Uses only "Search by part number" from the Tradesoft REST API v1 (section 4.11):
//   step 1: GET /api/v1/search/?code=XXX            -> list of brands for this part number
//   step 2: GET /api/v1/search/?code=XXX&brand=YYY  -> offers (price, stock, delivery)
//
// SECURITY
// - TRADESOFT_API_TOKEN is an admin token (it can read/delete customers, orders, price lists).
//   It never leaves this server. This function only ever calls the search endpoint.
// - Supplier cost price and supplier identity are removed before anything reaches the browser.
// - No CORS header is sent, so other websites cannot call this from their pages.
//
// Usage from the web app:
//   /api/store-search?code=0415231090            -> { brands: [...] }
//   /api/store-search?code=0415231090&brand=TOYOTA -> { total, offers: [...] } (cheapest first)
//   add &debug=1 to also get the list of field NAMES the store returned (no values),
//   which we use once to confirm the real response format.

const BASE = (process.env.TRADESOFT_API_BASE || 'https://shop.partsmateth.com').replace(/\/+$/, '');
const TOKEN = process.env.TRADESOFT_API_TOKEN;
const TIMEOUT_MS = 25000;

// Offer fields that are safe to show to customers.
// Deliberately excluded: supplierPrice (our cost), supplierID, supplierName, providersPricesID,
// articleFromSupplier, brandFromSupplier, direction (supplier warehouse code),
// deliveryWeightTax, deliveryCondition.
// orderHash is passed on as "offerId": it is an opaque code that Tradesoft needs to place
// an order for this exact offer later; it reveals nothing about the supplier or our cost.
const PUBLIC_OFFER_FIELDS = [
  'brand', 'code', 'description',
  'availability', 'availabilityRate', 'packing',
  'deliveryDaysMid', 'deliveryDaysMax',
  'currencyID', 'price', 'weight', 'volume', 'deliveryRate', 'date',
];
// The store returns numbers as text ("8.35"); these are converted to real numbers.
const NUMERIC_FIELDS = [
  'availability', 'availabilityRate', 'packing', 'deliveryDaysMid', 'deliveryDaysMax',
  'price', 'weight', 'volume', 'deliveryRate',
];
const MAX_OFFERS = 60;
const PUBLIC_BRAND_FIELDS = ['brand', 'code', 'description'];

const cleanCode = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 40);
const cleanBrand = (s) => String(s || '').trim().replace(/[^\p{L}\p{N} .&\-/]/gu, '').slice(0, 60);

function toArray(x) {
  if (Array.isArray(x)) return x;
  if (x && typeof x === 'object') return Object.values(x);
  return [];
}

function pick(obj, fields) {
  const out = {};
  for (const f of fields) {
    const v = obj?.[f];
    if (v !== undefined && v !== null && v !== '') out[f] = v;
  }
  return out;
}

function toPublicOffer(raw) {
  const o = pick(raw, PUBLIC_OFFER_FIELDS);
  for (const f of NUMERIC_FIELDS) {
    if (o[f] === undefined) continue;
    const n = Number(String(o[f]).replace(',', '.'));
    if (Number.isFinite(n)) o[f] = n; else delete o[f];
  }
  if (raw?.orderHash) o.offerId = String(raw.orderHash);
  return o;
}

function fieldNames(items) {
  const names = new Set();
  for (const it of items.slice(0, 20)) if (it && typeof it === 'object') Object.keys(it).forEach((k) => names.add(k));
  return [...names].sort();
}

async function callSearch(params) {
  const url = new URL(BASE + '/api/v1/search/');
  url.searchParams.set('token', TOKEN);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { Accept: 'application/json' } });
    const text = await r.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      const e = new Error(`Store returned a non-JSON response (HTTP ${r.status})`);
      e.status = 502;
      throw e;
    }
    if (data && data.error) {
      const e = new Error(data.errorMessage || String(data.error));
      e.status = 502;
      e.storeError = String(data.error);
      throw e;
    }
    return data && typeof data === 'object' && 'result' in data ? data.result : data;
  } catch (err) {
    if (err.name === 'AbortError') {
      const e = new Error('Store did not respond in time');
      e.status = 504;
      throw e;
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!TOKEN) {
    return res.status(500).json({ error: 'Store connection is not configured' });
  }

  const code = cleanCode(req.query.code);
  const brand = cleanBrand(req.query.brand);
  const debug = req.query.debug === '1';
  const useAnalogs = req.query.analogs === '1' ? 1 : 0;

  if (code.length < 3) {
    return res.status(400).json({ error: 'Please provide a part number (code)' });
  }

  try {
    if (!brand) {
      // Step 1: which brands have this part number
      const raw = toArray(await callSearch({ code, useWebSuppliers: 1 }));
      const body = { code, brands: raw.map((b) => pick(b, PUBLIC_BRAND_FIELDS)) };
      if (debug) body.fieldsReturned = fieldNames(raw);
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
      return res.status(200).json(body);
    }

    // Step 2: offers for this part number + brand
    const raw = toArray(await callSearch({ code, brand, useWebSuppliers: 1, useAnalogs }));
    const offers = raw
      .map(toPublicOffer)
      .filter((o) => o.price > 0 && (o.availability === undefined || o.availability > 0))
      .sort((a, b) => a.price - b.price || (a.deliveryDaysMax ?? 999) - (b.deliveryDaysMax ?? 999));
    const body = { code, brand, total: offers.length, offers: offers.slice(0, MAX_OFFERS) };
    if (debug) body.fieldsReturned = fieldNames(raw);
    res.setHeader('Cache-Control', 'public, s-maxage=300, stale-while-revalidate=900');
    return res.status(200).json(body);
  } catch (err) {
    console.error('store-search error:', err.storeError || '', err.message);
    return res.status(err.status || 500).json({ error: err.message || 'Store search failed' });
  }
}
