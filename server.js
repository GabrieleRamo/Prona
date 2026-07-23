/* Prona backend — zero-dependency Node.js server.
   Serves the static site AND a JSON API with real accounts and shared listings.
   Run:  node server.js   (then open http://localhost:3000)
   Data is stored in ./data/db.json — back it up like any database. */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const MAX_BODY = 25 * 1024 * 1024; // photos travel as base64

/* ---------------- tiny JSON-file database ---------------- */
let db = { users: [], sessions: {}, listings: [] };
function loadDb() {
  try { db = JSON.parse(fs.readFileSync(DB_FILE, "utf8")); }
  catch (e) { /* first run */ }
}
let saveTimer = null;
function saveDb() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DB_FILE); // atomic swap
  }, 150);
}
loadDb();

/* ---------------- password hashing (scrypt) ---------------- */
function hashPassword(pass) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pass, salt, 64).toString("hex");
  return salt + ":" + hash;
}
function verifyPassword(pass, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const check = crypto.scryptSync(pass, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash, "hex"), Buffer.from(check, "hex"));
}

/* ---------------- sessions (httpOnly cookie) ---------------- */
function newSession(email) {
  const token = crypto.randomBytes(32).toString("hex");
  db.sessions[token] = { email, createdAt: Date.now() };
  saveDb();
  return token;
}
function sessionUser(req) {
  const m = /(?:^|;\s*)prona_sid=([a-f0-9]{64})/.exec(req.headers.cookie || "");
  const s = m && db.sessions[m[1]];
  if (!s) return null;
  const u = db.users.find(x => x.email === s.email) || null;
  return u && u.banned ? null : u;
}
function sessionToken(req) {
  const m = /(?:^|;\s*)prona_sid=([a-f0-9]{64})/.exec(req.headers.cookie || "");
  return m ? m[1] : null;
}

/* ---------------- helpers ---------------- */
function json(res, code, obj, headers = {}) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error("too-large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", () => {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {}); }
      catch (e) { reject(new Error("bad-json")); }
    });
    req.on("error", reject);
  });
}
const publicUser = u => u ? { name: u.name, email: u.email, type: u.type, balance: u.balance || 0, transactions: (u.transactions || []).slice(0, 30), verified: !!u.verified, isAdmin: isAdmin(u), favorites: u.favorites || [], savedSearches: u.savedSearches || [], plan: userPlan(u), planExpiresAt: u.planExpiresAt || null, planCancelled: !!u.planCancelled, planCycle: u.planCycle === "annual" ? "annual" : "monthly" } : null;
const cleanStr = (v, max = 300) => String(v ?? "").slice(0, max);
const cleanNum = (v, max = 1e9) => Math.max(0, Math.min(max, Number(v) || 0));

function sanitizeListing(input, owner, existing, photoLimit) {
  const DEALS = ["sale", "rent", "daily"];
  const PTYPES = ["apartment", "house", "commercial", "plot", "parking"];
  const l = existing || {};
  const maxPhotos = typeof photoLimit === "number" && !Number.isNaN(photoLimit) ? photoLimit : 30;
  return {
    id: l.id || "srv-" + crypto.randomBytes(8).toString("hex"),
    owner, seeded: false,
    status: input.status === "draft" ? "draft" : "published",
    accountType: ["owner", "agent", "agency"].includes(input.accountType) ? input.accountType : "owner",
    dealType: DEALS.includes(input.dealType) ? input.dealType : "sale",
    propertyType: PTYPES.includes(input.propertyType) ? input.propertyType : "apartment",
    title: cleanStr(input.title), city: cleanStr(input.city, 40),
    complex: cleanStr(input.complex), street: cleanStr(input.street), houseNo: cleanStr(input.houseNo, 20),
    lng: Number(input.lng) || 0, lat: Number(input.lat) || 0,
    floor: cleanNum(input.floor, 200), floorsTotal: cleanNum(input.floorsTotal, 200),
    bedrooms: cleanNum(input.bedrooms, 50), rooms: cleanNum(input.rooms, 50), bathrooms: cleanNum(input.bathrooms, 20),
    totalArea: cleanNum(input.totalArea), livingArea: cleanNum(input.livingArea), terraceArea: cleanNum(input.terraceArea),
    features: Array.isArray(input.features) ? input.features.slice(0, 20).map(f => cleanStr(f, 40)) : [],
    description: cleanStr(input.description, 4000),
    photos: Array.isArray(input.photos) ? input.photos.slice(0, maxPhotos).filter(p => typeof p === "string" && p.startsWith("data:image/")) : [],
    youtube: cleanStr(input.youtube, 200),
    price: cleanNum(input.price), currency: input.currency === "ALL" ? "ALL" : "EUR",
    noCommission: !!input.noCommission,
    promoBid: cleanNum(input.promoBid, 100),
    contactName: cleanStr(input.contactName, 120), phone: cleanStr(input.phone, 40), whatsapp: !!input.whatsapp,
    createdAt: l.createdAt || Date.now(),
  };
}

/* ---------------- PayPal (real when env vars set, demo otherwise) ----------------
   Set PAYPAL_CLIENT_ID and PAYPAL_SECRET from a PayPal Business app
   (developer.paypal.com). PAYPAL_ENV=live for production, anything else = sandbox. */
const PP_ID = process.env.PAYPAL_CLIENT_ID || "";
const PP_SECRET = process.env.PAYPAL_SECRET || "";
const PP_BASE = process.env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
const PAYPAL_ON = !!(PP_ID && PP_SECRET);

async function ppToken() {
  const r = await fetch(PP_BASE + "/v1/oauth2/token", {
    method: "POST",
    headers: { Authorization: "Basic " + Buffer.from(PP_ID + ":" + PP_SECRET).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error("paypal-auth");
  return (await r.json()).access_token;
}
async function ppCreateOrder(amount) {
  const token = await ppToken();
  const r = await fetch(PP_BASE + "/v2/checkout/orders", {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ intent: "CAPTURE", purchase_units: [{ amount: { currency_code: "EUR", value: amount.toFixed(2) }, description: "Prona balance top-up" }] }),
  });
  const j = await r.json();
  if (!r.ok || !j.id) throw new Error("paypal-order");
  return j.id;
}
async function ppCaptureOrder(orderId) {
  const token = await ppToken();
  const r = await fetch(PP_BASE + `/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
  });
  const j = await r.json();
  if (!r.ok || j.status !== "COMPLETED") throw new Error("paypal-capture");
  const cap = j.purchase_units?.[0]?.payments?.captures?.[0];
  if (!cap || cap.status !== "COMPLETED" || cap.amount?.currency_code !== "EUR") throw new Error("paypal-capture");
  return { amount: Number(cap.amount.value), captureId: cap.id };
}

/* ---------------- email (Resend API; demo fallback returns codes in-app) ----------------
   Set RESEND_API_KEY and EMAIL_FROM (e.g. "Prona <noreply@prona.al>") to send
   real emails for verification, password reset and saved-search alerts. */
const RESEND_KEY = process.env.RESEND_API_KEY || "";
const EMAIL_FROM = process.env.EMAIL_FROM || "Prona <onboarding@resend.dev>";
const EMAIL_ON = !!RESEND_KEY;
async function sendEmail(to, subject, html) {
  if (!EMAIL_ON) return false;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: "Bearer " + RESEND_KEY, "Content-Type": "application/json" },
      body: JSON.stringify({ from: EMAIL_FROM, to: [to], subject, html }),
    });
    return r.ok;
  } catch (e) { return false; }
}
const sixDigit = () => String(crypto.randomInt(100000, 999999));

/* ---------------- admin ----------------
   Set ADMIN_EMAILS="you@example.com,other@example.com". If unset, the FIRST
   registered user becomes admin (fine for a demo — set the env var in production). */
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
const isAdmin = u => !!u && (ADMIN_EMAILS.length ? ADMIN_EMAILS.includes(u.email) : db.users[0] && db.users[0].email === u.email);

/* ---------------- photos on disk (instead of base64 in the DB) ---------------- */
const PHOTOS_DIR = path.join(DATA_DIR, "photos");
function storePhotos(photos) {
  return (photos || []).map(p => {
    if (typeof p !== "string") return null;
    if (p.startsWith("/photos/")) return p; // already stored
    const m = /^data:image\/(jpeg|png|webp);base64,(.+)$/.exec(p);
    if (!m) return null;
    fs.mkdirSync(PHOTOS_DIR, { recursive: true });
    const name = crypto.randomBytes(10).toString("hex") + "." + (m[1] === "jpeg" ? "jpg" : m[1]);
    fs.writeFileSync(path.join(PHOTOS_DIR, name), Buffer.from(m[2], "base64"));
    return "/photos/" + name;
  }).filter(Boolean);
}

/* ---------------- Crypto payments via Coinbase Commerce ----------------
   Supports BTC, ETH, USDT, SOL (and more). Create a free account at
   commerce.coinbase.com, generate an API key, and set COINBASE_COMMERCE_API_KEY.
   Payments are verified server-side before the balance is credited. */
const CC_KEY = process.env.COINBASE_COMMERCE_API_KEY || "";
const CRYPTO_ON = !!CC_KEY;
const CC_BASE = "https://api.commerce.coinbase.com";

async function ccCreateCharge(amount, email) {
  const r = await fetch(CC_BASE + "/charges", {
    method: "POST",
    headers: { "X-CC-Api-Key": CC_KEY, "X-CC-Version": "2018-03-22", "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Prona — rimbushje bilanci",
      description: "Rimbushje e bilancit për promovimin e shpalljeve",
      pricing_type: "fixed_price",
      local_price: { amount: amount.toFixed(2), currency: "EUR" },
      metadata: { email },
    }),
  });
  const j = await r.json();
  if (!r.ok || !j.data?.code) throw new Error("crypto-charge");
  return { code: j.data.code, url: j.data.hosted_url };
}
async function ccGetCharge(code) {
  const r = await fetch(CC_BASE + `/charges/${encodeURIComponent(code)}`, {
    headers: { "X-CC-Api-Key": CC_KEY, "X-CC-Version": "2018-03-22" },
  });
  const j = await r.json();
  if (!r.ok || !j.data) throw new Error("crypto-charge");
  return j.data;
}
function chargeIsPaid(charge) {
  const done = (charge.timeline || []).some(t => ["COMPLETED", "RESOLVED"].includes(t.status));
  return done || ["COMPLETED", "RESOLVED"].includes(charge.status);
}

function credit(user, amount, type, note) {
  user.balance = Math.round(((user.balance || 0) + amount) * 100) / 100;
  user.transactions = user.transactions || [];
  user.transactions.unshift({ amount, type, note, at: Date.now(), balance: user.balance });
  user.transactions = user.transactions.slice(0, 100);
  saveDb();
}

/* ---------------- subscription plans ---------------- */
const PLANS = {
  free:    { name: "Falas",   listings: 15,        photos: 15,        price: 0,    priceAnnual: 0 },
  pro:     { name: "Pro",     listings: 40,        photos: 30,        price: 1400, priceAnnual: 12600 },
  premium: { name: "Premium", listings: Infinity,  photos: Infinity,  price: 3900, priceAnnual: 29000 },
};
const userPlan = u => (u && PLANS[u.plan] && (!u.planExpiresAt || u.planExpiresAt > Date.now())) ? u.plan : "free";
function publishedCount(email, exceptId) {
  return db.listings.filter(l => l.owner === email && l.status === "published" && l.id !== exceptId).length;
}
function runSubscriptionBilling() {
  const now = Date.now();
  for (const u of db.users) {
    if (!u.plan || u.plan === "free" || !u.planExpiresAt || u.planExpiresAt > now) continue;
    const cycle = u.planCycle === "annual" ? "annual" : "monthly";
    const price = (PLANS[u.plan] || {})[cycle === "annual" ? "priceAnnual" : "price"] || 0;
    const days = cycle === "annual" ? 365 : 30;
    if (!u.planCancelled && (u.balance || 0) >= price) {
      credit(u, -price, "subscription", `Rinovim plani ${PLANS[u.plan].name} · ${cycle === "annual" ? "vjetor" : "mujor"}`);
      u.planExpiresAt = now + days * DAY;
    } else {
      u.plan = "free"; delete u.planExpiresAt; delete u.planCancelled; delete u.planCycle;
    }
  }
  saveDb();
}

/* ---------------- lead tracking ---------------- */
function trackEvent(listing, type) {
  const key = { view: "v", phone: "p", whatsapp: "w" }[type];
  if (!key) return;
  listing.stats = listing.stats || { v: 0, p: 0, w: 0 };
  listing.stats[key] = (listing.stats[key] || 0) + 1;
  const day = new Date().toISOString().slice(0, 10);
  listing.statsDaily = listing.statsDaily || {};
  listing.statsDaily[day] = listing.statsDaily[day] || { v: 0, p: 0, w: 0 };
  listing.statsDaily[day][key]++;
  // keep 30 days
  const days = Object.keys(listing.statsDaily).sort();
  while (days.length > 30) delete listing.statsDaily[days.shift()];
  saveDb();
}
const stripStats = (l, viewerEmail) =>
  l.owner === viewerEmail ? l : (({ stats, statsDaily, ...rest }) => rest)(l);

/* ---------------- saved-search email alerts ---------------- */
function searchMatchesListing(p, l) {
  return l.status === "published"
    && (!p.deal || l.dealType === p.deal) && (!p.city || l.city === p.city)
    && (!p.ptype || l.propertyType === p.ptype) && (!p.beds || l.bedrooms >= p.beds)
    && (!p.baths || (l.bathrooms || 0) >= p.baths)
    && (!p.priceMin || l.price >= p.priceMin) && (!p.priceMax || l.price <= p.priceMax)
    && (!p.areaMin || l.totalArea >= p.areaMin) && (!p.areaMax || l.totalArea <= p.areaMax);
}
function notifySavedSearches(listing) {
  if (!EMAIL_ON || listing.status !== "published") return;
  for (const u of db.users) {
    if (u.email === listing.owner || u.banned) continue;
    const hit = (u.savedSearches || []).find(s => searchMatchesListing(s.params || {}, listing));
    if (hit) sendEmail(u.email, "Pronë e re që përputhet me kërkimin tuaj — Prona",
      `<p><b>${listing.title}</b> — €${listing.price}, ${listing.totalArea} m²</p><p>Përputhet me kërkimin tuaj të ruajtur "${hit.name}".</p>`)
      .catch(() => {});
  }
}

/* ---------------- daily promotion billing ---------------- */
const DAY = 24 * 60 * 60 * 1000;
function runPromotionBilling() {
  const now = Date.now();
  for (const l of db.listings) {
    if (l.status !== "published" || !(l.promoBid > 0)) continue;
    if (now - (l.promoChargedAt || 0) < DAY) continue;
    const owner = db.users.find(u => u.email === l.owner);
    if (owner && (owner.balance || 0) >= l.promoBid) {
      credit(owner, -l.promoBid, "promotion", `Promovim ditor · ${l.title}`);
      l.promoChargedAt = now;
    } else {
      l.promoBid = 0; // balance ran out — promotion pauses, listing stays published
      l.promoChargedAt = 0;
    }
  }
  saveDb();
}
setInterval(() => { runPromotionBilling(); runSubscriptionBilling(); }, 60 * 60 * 1000);
setTimeout(() => { runPromotionBilling(); runSubscriptionBilling(); }, 5000);

/* ---------------- API routes ---------------- */
async function api(req, res, url) {
  const user = sessionUser(req);

  if (req.method === "GET" && url.pathname === "/api/state") {
    const listings = db.listings.filter(l => l.status === "published" || (user && l.owner === user.email))
      .map(l => stripStats(l, user && user.email));
    return json(res, 200, { user: publicUser(user), listings, payments: {
      provider: PAYPAL_ON ? "paypal" : "demo",
      clientId: PAYPAL_ON ? PP_ID : undefined,
      env: PAYPAL_ON ? (process.env.PAYPAL_ENV === "live" ? "live" : "sandbox") : undefined,
      crypto: CRYPTO_ON,
    } });
  }

  if (req.method === "POST" && url.pathname === "/api/pay/crypto/create") {
    if (!user) return json(res, 401, { error: "Hyni fillimisht." });
    if (!CRYPTO_ON) return json(res, 400, { error: "Pagesat me kriptomonedha nuk janë konfiguruar në këtë server." });
    const b = await readBody(req);
    const amount = Math.round(cleanNum(b.amount, 10000) * 100) / 100;
    if (amount < 1) return json(res, 400, { error: "Rimbushja minimale është €1." });
    try {
      const ch = await ccCreateCharge(amount, user.email);
      db.cryptoCharges = db.cryptoCharges || {};
      db.cryptoCharges[ch.code] = { email: user.email, amount, credited: false, createdAt: Date.now() };
      saveDb();
      return json(res, 200, { code: ch.code, url: ch.url });
    } catch (e) { return json(res, 502, { error: "Nuk u krijua pagesa kripto — provoni përsëri." }); }
  }

  if (req.method === "POST" && url.pathname === "/api/pay/crypto/check") {
    if (!user) return json(res, 401, { error: "Hyni fillimisht." });
    if (!CRYPTO_ON) return json(res, 400, { error: "Pagesat me kriptomonedha nuk janë konfiguruar në këtë server." });
    const b = await readBody(req);
    const rec = (db.cryptoCharges || {})[String(b.code || "")];
    if (!rec || rec.email !== user.email) return json(res, 404, { error: "Pagesa nuk u gjet." });
    if (rec.credited) return json(res, 200, { status: "credited", user: publicUser(user) });
    try {
      const charge = await ccGetCharge(String(b.code));
      if (chargeIsPaid(charge)) {
        rec.credited = true;
        credit(user, rec.amount, "topup", "Rimbushje kripto (Coinbase Commerce) · " + String(b.code));
        return json(res, 200, { status: "credited", user: publicUser(user) });
      }
      return json(res, 200, { status: charge.status || "PENDING" });
    } catch (e) { return json(res, 502, { error: "Nuk u verifikua pagesa — provoni përsëri pas pak." }); }
  }

  if (req.method === "POST" && url.pathname === "/api/pay/create-order") {
    if (!user) return json(res, 401, { error: "Hyni fillimisht." });
    const b = await readBody(req);
    const amount = Math.round(cleanNum(b.amount, 10000) * 100) / 100;
    if (amount < 1) return json(res, 400, { error: "Rimbushja minimale është €1." });
    if (!PAYPAL_ON) return json(res, 400, { error: "PayPal nuk është konfiguruar në këtë server." });
    try { return json(res, 200, { orderId: await ppCreateOrder(amount) }); }
    catch (e) { return json(res, 502, { error: "Nuk u nis pagesa me PayPal — provoni përsëri." }); }
  }

  if (req.method === "POST" && url.pathname === "/api/pay/capture") {
    if (!user) return json(res, 401, { error: "Hyni fillimisht." });
    const b = await readBody(req);
    if (!PAYPAL_ON) return json(res, 400, { error: "PayPal nuk është konfiguruar në këtë server." });
    try {
      const cap = await ppCaptureOrder(String(b.orderId || ""));
      credit(user, cap.amount, "topup", "Rimbushje PayPal · " + cap.captureId);
      return json(res, 200, { user: publicUser(user) });
    } catch (e) { return json(res, 502, { error: "Pagesa nuk u përfundua — nuk jeni faturuar dy herë; kontrolloni PayPal dhe provoni përsëri." }); }
  }

  /* Demo top-up — active ONLY while PayPal keys are not configured, so you can
     test the promotion flow end-to-end before connecting a real account. */
  if (req.method === "POST" && url.pathname === "/api/pay/demo-topup") {
    if (!user) return json(res, 401, { error: "Hyni fillimisht." });
    if (PAYPAL_ON) return json(res, 400, { error: "Rimbushja demo është çaktivizuar — PayPal është aktiv në këtë server." });
    const b = await readBody(req);
    const amount = Math.round(cleanNum(b.amount, 1000) * 100) / 100;
    if (amount < 1) return json(res, 400, { error: "Rimbushja minimale është €1." });
    credit(user, amount, "topup", "Rimbushje demo (pa pagesë reale)");
    return json(res, 200, { user: publicUser(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/register") {
    const b = await readBody(req);
    const email = cleanStr(b.email, 200).trim().toLowerCase();
    const name = cleanStr(b.name, 120).trim();
    const pass = String(b.password || "");
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: "Shkruani një email të vlefshëm." });
    if (pass.length < 6) return json(res, 400, { error: "Fjalëkalimi duhet të ketë të paktën 6 karaktere." });
    if (!name) return json(res, 400, { error: "Shkruani emrin tuaj." });
    if (db.users.some(u => u.email === email)) return json(res, 409, { error: "Ky email është i regjistruar — provoni të hyni." });
    const u = { name, email, pass: hashPassword(pass), type: ["owner", "agent", "agency"].includes(b.type) ? b.type : "owner", balance: 0, transactions: [], favorites: [], savedSearches: [], verified: false, verifyCode: sixDigit(), createdAt: Date.now() };
    db.users.push(u);
    const token = newSession(email);
    const sent = await sendEmail(email, "Verifikoni llogarinë tuaj në Prona", `<p>Kodi juaj i verifikimit: <b style="font-size:20px">${u.verifyCode}</b></p>`);
    return json(res, 200, { user: publicUser(u), devCode: EMAIL_ON && sent ? undefined : u.verifyCode }, { "Set-Cookie": `prona_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` });
  }

  if (req.method === "POST" && url.pathname === "/api/verify") {
    if (!user) return json(res, 401, { error: "Hyni fillimisht." });
    const b = await readBody(req);
    if (user.verified) return json(res, 200, { user: publicUser(user) });
    if (b.resend) {
      user.verifyCode = user.verifyCode || sixDigit(); saveDb();
      const sent = await sendEmail(user.email, "Verifikoni llogarinë tuaj në Prona", `<p>Kodi juaj i verifikimit: <b style="font-size:20px">${user.verifyCode}</b></p>`);
      return json(res, 200, { ok: true, devCode: EMAIL_ON && sent ? undefined : user.verifyCode });
    }
    if (String(b.code || "").trim() !== user.verifyCode) return json(res, 400, { error: "Kod i pasaktë — kontrolloni dhe provoni përsëri." });
    user.verified = true; delete user.verifyCode; saveDb();
    return json(res, 200, { user: publicUser(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/reset/request") {
    const b = await readBody(req);
    const email = cleanStr(b.email, 200).trim().toLowerCase();
    const u = db.users.find(x => x.email === email);
    // do not reveal whether the email exists
    if (!u) return json(res, 200, { ok: true });
    u.resetCode = sixDigit(); u.resetAt = Date.now(); saveDb();
    const sent = await sendEmail(email, "Rivendosja e fjalëkalimit — Prona", `<p>Kodi për rivendosjen e fjalëkalimit: <b style="font-size:20px">${u.resetCode}</b></p>`);
    return json(res, 200, { ok: true, devCode: EMAIL_ON && sent ? undefined : u.resetCode });
  }

  if (req.method === "POST" && url.pathname === "/api/reset/confirm") {
    const b = await readBody(req);
    const email = cleanStr(b.email, 200).trim().toLowerCase();
    const u = db.users.find(x => x.email === email);
    if (!u || !u.resetCode || String(b.code || "").trim() !== u.resetCode || Date.now() - (u.resetAt || 0) > 3600000)
      return json(res, 400, { error: "Kod i pasaktë ose i skaduar." });
    if (String(b.password || "").length < 6) return json(res, 400, { error: "Fjalëkalimi duhet të ketë të paktën 6 karaktere." });
    u.pass = hashPassword(String(b.password)); delete u.resetCode; delete u.resetAt; saveDb();
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/login") {
    const b = await readBody(req);
    const email = cleanStr(b.email, 200).trim().toLowerCase();
    const u = db.users.find(x => x.email === email);
    if (!u || !verifyPassword(String(b.password || ""), u.pass)) return json(res, 401, { error: "Email ose fjalëkalim i gabuar." });
    if (u.banned) return json(res, 403, { error: "Kjo llogari është pezulluar." });
    const token = newSession(email);
    return json(res, 200, { user: publicUser(u) }, { "Set-Cookie": `prona_sid=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000` });
  }

  if (req.method === "POST" && url.pathname === "/api/plan") {
    if (!user) return json(res, 401, { error: "Hyni fillimisht." });
    const b = await readBody(req);
    const plan = String(b.plan || "");
    const cycle = b.cycle === "annual" ? "annual" : "monthly";
    if (!PLANS[plan] || plan === "free") return json(res, 400, { error: "Plan i pavlefshëm." });
    if (userPlan(user) === plan && user.planCycle === cycle) return json(res, 400, { error: "Ky është plani juaj aktual." });
    const price = cycle === "annual" ? PLANS[plan].priceAnnual : PLANS[plan].price;
    const days = cycle === "annual" ? 365 : 30;
    if ((user.balance || 0) < price)
      return json(res, 402, { error: `Bilanci juaj (${(user.balance || 0).toFixed(2)} L) nuk mbulon planin ${PLANS[plan].name} (${price.toLocaleString("en-US")} L${cycle === "annual" ? "/vit" : "/muaj"}). Rimbushni bilancin fillimisht.` });
    credit(user, -price, "subscription", `Plani ${PLANS[plan].name} · ${days} ditë`);
    user.plan = plan; user.planCycle = cycle; user.planExpiresAt = Date.now() + days * DAY; user.planCancelled = false;
    saveDb();
    return json(res, 200, { user: publicUser(user) });
  }
  if (req.method === "POST" && url.pathname === "/api/plan/cancel") {
    if (!user) return json(res, 401, { error: "Hyni fillimisht." });
    user.planCancelled = true; saveDb();
    return json(res, 200, { user: publicUser(user) });
  }

  if (req.method === "POST" && url.pathname === "/api/track") {
    const b = await readBody(req);
    const l = db.listings.find(x => x.id === String(b.id || "") && x.status === "published");
    if (l) trackEvent(l, String(b.type || ""));
    return json(res, 200, { ok: true });
  }

  if (req.method === "POST" && url.pathname === "/api/favorites/toggle") {
    if (!user) return json(res, 401, { error: "Hyni fillimisht." });
    const b = await readBody(req);
    const id = cleanStr(b.id, 60);
    user.favorites = user.favorites || [];
    const i = user.favorites.indexOf(id);
    i >= 0 ? user.favorites.splice(i, 1) : user.favorites.push(id);
    saveDb();
    return json(res, 200, { favorites: user.favorites });
  }

  if (req.method === "POST" && url.pathname === "/api/searches") {
    if (!user) return json(res, 401, { error: "Hyni fillimisht." });
    const b = await readBody(req);
    user.savedSearches = user.savedSearches || [];
    if (user.savedSearches.length >= 20) return json(res, 400, { error: "Maksimumi 20 kërkime të ruajtura." });
    const rec = { id: "s-" + crypto.randomBytes(6).toString("hex"), name: cleanStr(b.name, 80) || "Kërkim", params: b.params || {}, createdAt: Date.now(), lastSeenAt: Date.now() };
    user.savedSearches.push(rec); saveDb();
    return json(res, 200, { savedSearches: user.savedSearches });
  }
  {
    const sm = /^\/api\/searches\/([\w-]+)$/.exec(url.pathname);
    if (sm && user) {
      user.savedSearches = user.savedSearches || [];
      const i = user.savedSearches.findIndex(s => s.id === sm[1]);
      if (i < 0) return json(res, 404, { error: "Kërkimi nuk u gjet." });
      if (req.method === "DELETE") { user.savedSearches.splice(i, 1); saveDb(); return json(res, 200, { savedSearches: user.savedSearches }); }
      if (req.method === "PUT") { user.savedSearches[i].lastSeenAt = Date.now(); saveDb(); return json(res, 200, { savedSearches: user.savedSearches }); }
    }
  }

  /* ---- admin ---- */
  if (url.pathname.startsWith("/api/admin/")) {
    if (!isAdmin(user)) return json(res, 403, { error: "Vetëm administratori." });
    if (req.method === "GET" && url.pathname === "/api/admin/overview") {
      const revenue = db.users.flatMap(x => x.transactions || []).filter(t => t.type === "promotion").reduce((s, t) => s - t.amount, 0);
      return json(res, 200, {
        users: db.users.map(x => ({ name: x.name, email: x.email, type: x.type, banned: !!x.banned, verified: !!x.verified, balance: x.balance || 0, listings: db.listings.filter(l => l.owner === x.email).length, createdAt: x.createdAt })),
        listingsCount: db.listings.length,
        publishedCount: db.listings.filter(l => l.status === "published").length,
        promotedCount: db.listings.filter(l => l.promoBid > 0).length,
        revenue: Math.round(revenue * 100) / 100,
      });
    }
    const am = /^\/api\/admin\/listings\/([\w-]+)$/.exec(url.pathname);
    if (am && req.method === "DELETE") {
      const i = db.listings.findIndex(l => l.id === am[1]);
      if (i < 0) return json(res, 404, { error: "Shpallja nuk u gjet." });
      db.listings.splice(i, 1); saveDb();
      return json(res, 200, { ok: true });
    }
    const bm = /^\/api\/admin\/ban\/(.+)$/.exec(url.pathname);
    if (bm && req.method === "POST") {
      const target = db.users.find(x => x.email === decodeURIComponent(bm[1]).toLowerCase());
      if (!target) return json(res, 404, { error: "Përdoruesi nuk u gjet." });
      if (isAdmin(target)) return json(res, 400, { error: "Nuk mund të pezulloni administratorin." });
      target.banned = !target.banned;
      db.listings.forEach(l => { if (l.owner === target.email && target.banned) l.status = "draft"; });
      saveDb();
      return json(res, 200, { banned: target.banned });
    }
  }

  if (req.method === "POST" && url.pathname === "/api/logout") {
    const t = sessionToken(req);
    if (t) { delete db.sessions[t]; saveDb(); }
    return json(res, 200, { ok: true }, { "Set-Cookie": "prona_sid=; Path=/; HttpOnly; Max-Age=0" });
  }

  /* Charge the first promotion day when a promotion starts (new or increased from 0).
     Returns an error string if the balance can't cover it. */
  function startPromotion(rec, prev) {
    const wasPromoted = prev && prev.promoBid > 0 && prev.status === "published";
    if (rec.status !== "published" || !(rec.promoBid > 0) || wasPromoted) {
      if (prev) rec.promoChargedAt = prev.promoChargedAt || 0;
      return null;
    }
    if ((user.balance || 0) < rec.promoBid)
      return `Bilanci juaj (€${(user.balance || 0).toFixed(2)}) nuk mbulon ditën e parë të promovimit (€${rec.promoBid}). Rimbushni bilancin ose ulni ofertën.`;
    credit(user, -rec.promoBid, "promotion", `Promovim ditor · ${rec.title}`);
    rec.promoChargedAt = Date.now();
    return null;
  }

  if (url.pathname === "/api/listings" && req.method === "POST") {
    if (!user) return json(res, 401, { error: "Hyni fillimisht." });
    const b = await readBody(req);
    const plan0 = userPlan(user);
    const rec = sanitizeListing(b, user.email, null, PLANS[plan0].photos);
    if (rec.status === "published" && !user.verified) return json(res, 403, { error: "Verifikoni email-in tuaj para se të publikoni. Kodin e gjeni te llogaria juaj.", needsVerify: true });
    if (rec.status === "published") {
      const plan = plan0, limit = PLANS[plan].listings;
      if (publishedCount(user.email, rec.id) >= limit)
        return json(res, 403, { error: `Plani juaj (${PLANS[plan].name}) lejon ${limit} shpallje aktive. Kaloni në një plan më të lartë për të publikuar më shumë.`, needsPlan: true });
      rec.ownerPlan = plan;
    }
    rec.photos = storePhotos(rec.photos);
    const payErr = startPromotion(rec, null);
    if (payErr) return json(res, 402, { error: payErr });
    db.listings.push(rec); saveDb();
    notifySavedSearches(rec); // fire-and-forget email alerts
    return json(res, 200, { listing: rec, user: publicUser(user) });
  }

  const idMatch = /^\/api\/listings\/([\w-]+)$/.exec(url.pathname);
  if (idMatch) {
    if (!user) return json(res, 401, { error: "Hyni fillimisht." });
    const i = db.listings.findIndex(l => l.id === idMatch[1] && l.owner === user.email);
    if (i < 0) return json(res, 404, { error: "Shpallja nuk u gjet." });
    if (req.method === "PUT") {
      const b = await readBody(req);
      const plan0 = userPlan(user);
      const rec = sanitizeListing(b, user.email, db.listings[i], PLANS[plan0].photos);
      if (rec.status === "published" && !user.verified) return json(res, 403, { error: "Verifikoni email-in tuaj para se të publikoni.", needsVerify: true });
      if (rec.status === "published" && db.listings[i].status !== "published") {
        const plan = plan0, limit = PLANS[plan].listings;
        if (publishedCount(user.email, rec.id) >= limit)
          return json(res, 403, { error: `Plani juaj (${PLANS[plan].name}) lejon ${limit} shpallje aktive. Kaloni në një plan më të lartë.`, needsPlan: true });
      }
      if (rec.status === "published") rec.ownerPlan = userPlan(user);
      rec.stats = db.listings[i].stats; rec.statsDaily = db.listings[i].statsDaily;
      rec.photos = storePhotos(rec.photos);
      const payErr = startPromotion(rec, db.listings[i]);
      if (payErr) return json(res, 402, { error: payErr });
      db.listings[i] = rec; saveDb();
      return json(res, 200, { listing: rec, user: publicUser(user) });
    }
    if (req.method === "DELETE") {
      db.listings.splice(i, 1); saveDb();
      return json(res, 200, { ok: true });
    }
  }

  return json(res, 404, { error: "Unknown API route." });
}

/* ---------------- SEO: crawlable listing pages, sitemap, robots ---------------- */
const escHtml = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function seoPage(req, res, id) {
  const l = db.listings.find(x => x.id === id && x.status === "published");
  if (!l) { res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" }); return res.end("<h1>404</h1>"); }
  const host = req.headers.host || "localhost";
  const priceTxt = "€" + l.price + (l.dealType === "rent" ? "/muaj" : l.dealType === "daily" ? "/natë" : "");
  const desc = `${l.title} — ${priceTxt}, ${l.totalArea} m²${l.bedrooms ? ", " + l.bedrooms + " dhoma gjumi" : ""}. ${escHtml((l.description || "").slice(0, 150))}`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html lang="sq"><head><meta charset="utf-8">
<title>${escHtml(l.title)} — Prona</title>
<meta name="description" content="${escHtml(desc)}">
<meta property="og:title" content="${escHtml(l.title)} — ${priceTxt}">
<meta property="og:description" content="${escHtml(desc)}">
${l.photos && l.photos[0] && l.photos[0].startsWith("/photos/") ? `<meta property="og:image" content="https://${escHtml(host)}${escHtml(l.photos[0])}">` : ""}
<link rel="canonical" href="https://${escHtml(host)}/prona/${escHtml(l.id)}">
<script>location.replace("/#/property/${encodeURIComponent(l.id)}");</script>
</head><body>
<h1>${escHtml(l.title)}</h1><p>${escHtml(desc)}</p>
<p><a href="/#/property/${encodeURIComponent(l.id)}">Shiko shpalljen në Prona</a></p>
</body></html>`);
}
function sitemap(req, res) {
  const host = req.headers.host || "localhost";
  const urls = db.listings.filter(l => l.status === "published")
    .map(l => `<url><loc>https://${host}/prona/${l.id}</loc><lastmod>${new Date(l.createdAt).toISOString().slice(0, 10)}</lastmod></url>`).join("");
  res.writeHead(200, { "Content-Type": "application/xml" });
  res.end(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://${host}/</loc></url>${urls}</urlset>`);
}

/* ---------------- static files ---------------- */
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".md": "text/plain; charset=utf-8" };
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === "/") p = "/index.html";
  if (p.startsWith("/photos/")) {
    const pf = path.join(PHOTOS_DIR, path.normalize(p.slice(8)));
    if (!pf.startsWith(PHOTOS_DIR)) { res.writeHead(403); return res.end("Forbidden"); }
    return fs.readFile(pf, (err, buf) => {
      if (err) { res.writeHead(404); return res.end("Not found"); }
      res.writeHead(200, { "Content-Type": MIME[path.extname(pf)] || "image/jpeg", "Cache-Control": "public, max-age=604800" });
      res.end(buf);
    });
  }
  const file = path.join(ROOT, path.normalize(p));
  if (!file.startsWith(ROOT) || file.includes(path.sep + "data" + path.sep) || file === path.join(ROOT, "server.js")) {
    res.writeHead(403); return res.end("Forbidden");
  }
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end("Not found"); }
    res.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": p.match(/maplibre|data\.js/) ? "public, max-age=86400" : "no-cache" });
    res.end(buf);
  });
}

/* ---------------- server ---------------- */
http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  try {
    if (url.pathname.startsWith("/api/")) await api(req, res, url);
    else if (req.method === "GET" && /^\/prona\/[\w-]+$/.test(url.pathname)) seoPage(req, res, url.pathname.slice(7));
    else if (req.method === "GET" && url.pathname === "/sitemap.xml") sitemap(req, res);
    else if (req.method === "GET" && url.pathname === "/robots.txt") { res.writeHead(200, { "Content-Type": "text/plain" }); res.end("User-agent: *\nAllow: /\nSitemap: /sitemap.xml\n"); }
    else if (req.method === "GET") serveStatic(req, res, url);
    else { res.writeHead(405); res.end(); }
  } catch (e) {
    json(res, e.message === "too-large" ? 413 : 500, { error: e.message === "too-large" ? "Ngarkimi shumë i madh — përdorni më pak ose foto më të vogla." : "Gabim serveri." });
  }
}).listen(PORT, () => console.log(`Prona running on http://localhost:${PORT}`));
