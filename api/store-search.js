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
//   add &analogs=1 to also get every interchangeable part number:
//     { alternativesTotal, alternatives: [{ code, brand, description, offerCount, cheapest, fastest }] }
//   add &debug=1 to also get the list of field NAMES the store returned (no values),
//   which we use once to confirm the real response format.

const BASE = (process.env.TRADESOFT_API_BASE || 'https://shop.partsmateth.com').replace(/\/+$/, '');
const TOKEN = process.env.TRADESOFT_API_TOKEN;
const TIMEOUT_MS = 20000;

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
// Safety caps only; real searches return well below these, so customers see every option.
const MAX_OFFERS = 400;          // offers for the searched part number
const MAX_ALT_PARTS = 400;       // interchangeable part numbers (each grouped into one entry)
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Tradesoft sometimes answers with a one-off error ("Unexpected error, data not saved").
// Try once more after a short pause before giving up (not after a timeout, to stay fast).
async function callSearchRetry(params) {
  try {
    return await callSearch(params);
  } catch (err) {
    if (err.status === 504) throw err;
    await sleep(600);
    return callSearch(params);
  }
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

// Simple per-visitor limit, so one visitor (or a bot) cannot flood our suppliers with
// searches. Each server instance keeps its own count; repeated identical searches are
// also answered from Vercel's cache without reaching this code at all.
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX = 40; // store requests per visitor per minute
const hits = new Map();
function rateLimited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) for (const [k, v] of hits) if (now - v[v.length - 1] > RATE_WINDOW_MS) hits.delete(k);
  return recent.length > RATE_MAX;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }
  if (!TOKEN) {
    return res.status(500).json({ error: 'Store connection is not configured' });
  }

  const ip = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({ error: 'Too many searches. Please wait a minute and try again.' });
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
      const raw = toArray(await callSearchRetry({ code, useWebSuppliers: 1 }));
      const body = { code, brands: raw.map((b) => pick(b, PUBLIC_BRAND_FIELDS)) };
      if (debug) body.fieldsReturned = fieldNames(raw);
      res.setHeader('Cache-Control', 'public, s-maxage=600, stale-while-revalidate=1800');
      return res.status(200).json(body);
    }

    // Step 2: offers for this part number + brand.
    // For some part numbers with very large interchange lists, Tradesoft fails when asked to include
    // interchangeable parts. In that case we still return every offer for the searched part number
    // (asking again without interchanges) and tell the page the alternatives could not be loaded.
    let raw;
    let alternativesUnavailable = false;
    if (useAnalogs) {
      try {
        raw = toArray(await callSearch({ code, brand, useWebSuppliers: 1, useAnalogs: 1 }));
      } catch (err) {
        console.error('store-search: interchanges failed, retrying without:', err.storeError || '', err.message);
        alternativesUnavailable = true;
        raw = toArray(await callSearchRetry({ code, brand, useWebSuppliers: 1, useAnalogs: 0 }));
      }
    } else {
      raw = toArray(await callSearchRetry({ code, brand, useWebSuppliers: 1, useAnalogs: 0 }));
    }
    const all = raw
      .map(toPublicOffer)
      .filter((o) => o.price > 0 && (o.availability === undefined || o.availability > 0))
      .sort((a, b) => a.price - b.price || (a.deliveryDaysMax ?? 999) - (b.deliveryDaysMax ?? 999));
    // Offers for the exact part number searched vs. interchangeable part numbers
    // (only present when analogs=1).
    const offers = all.filter((o) => cleanCode(o.code) === code);
    const body = { code, brand, total: offers.length, offers: offers.slice(0, MAX_OFFERS) };
    if (alternativesUnavailable) body.alternativesUnavailable = true;
    if (useAnalogs && !alternativesUnavailable) {
      // One entry per interchangeable part number (code + brand) with its cheapest and its
      // fastest offer, so every alternative is listed no matter how many offers each has.
      const groups = new Map();
      for (const o of all) {
        if (cleanCode(o.code) === code) continue;
        const key = cleanCode(o.code) + '|' + String(o.brand || '').toUpperCase();
        let g = groups.get(key);
        if (!g) {
          g = { code: cleanCode(o.code), brand: o.brand || '', description: o.description || '', offerCount: 0, cheapest: o, fastest: o };
          groups.set(key, g);
        }
        g.offerCount++;
        if (!g.description && o.description) g.description = o.description;
        const d = (x) => x.deliveryDaysMax ?? x.deliveryDaysMid ?? 999;
        if (d(o) < d(g.fastest) || (d(o) === d(g.fastest) && o.price < g.fastest.price)) g.fastest = o;
      }
      const list = [...groups.values()];
      body.alternativesTotal = list.length;
      body.alternativeOffersTotal = list.reduce((n, g) => n + g.offerCount, 0);
      body.alternatives = list.slice(0, MAX_ALT_PARTS);
    }
    if (debug) body.fieldsReturned = fieldNames(raw);
    // A fallback answer (without alternatives) is only cached briefly, so a later visit can try again.
    res.setHeader('Cache-Control', alternativesUnavailable ? 'public, s-maxage=60' : 'public, s-maxage=300, stale-while-revalidate=900');
    return res.status(200).json(body);
  } catch (err) {
    console.error('store-search error:', err.storeError || '', err.message);
    const body = { error: err.message || 'Store search failed' };
    if (err.storeError) body.storeError = err.storeError; // Tradesoft's own error code, to help diagnose
    return res.status(err.status || 500).json(body);
  }
}
