# Prona — real-estate portal for Albania

A korter.ge-style property website: full Albania map (streets + satellite), listings
with filters, property detail pages, user accounts, and a complete add-property flow
(deal type, property type, address with map pin, apartment details, layout features,
photos, price, contacts).

## Files

| File | Purpose |
|---|---|
| `index.html` | Page shell |
| `app.css` | All styles |
| `app.js` | Full application (routing, map, auth, listing form) |
| `data.js` | Embedded OSM fallback data (country outline, roads, 5 city centres with ~37k buildings) |
| `maplibre-gl.js` / `.css` | MapLibre GL v4.7.1 (open-source map renderer) |
| `server.js` | Backend: accounts, sessions, shared listings. Zero dependencies — plain Node.js |

## Hosting — full site with accounts (recommended)

The backend needs any host that runs Node.js (Render, Railway, Fly.io — all have
free tiers — or any VPS). No `npm install` needed; there are zero dependencies.

```
node server.js        # → http://localhost:3000
```

- Serves the website and a JSON API (`/api/...`) from one process.
- Users register/log in (passwords hashed with scrypt, httpOnly session cookies).
- Listings are stored server-side in `data/db.json` and **shared between all
  visitors** — someone adds a property, everyone sees it on the map.
- Back up the `data/` folder; it is your database.
- On Render/Railway: create a "Web Service" from this folder, start command
  `node server.js`. Attach a persistent disk for `data/`. Point your domain at it.

The front-end detects the API automatically. **Fallback:** if you instead upload
the folder to a static-only host (Netlify/Vercel/GitHub Pages), everything still
works but accounts/listings stay in each visitor's own browser — fine for demos.

## Payments (PayPal) — listing promotion

Users top up a balance and bid €/day to promote listings (higher bid = higher
position in the category). The first day is charged at publish; a billing job
charges each further day and pauses the promotion when the balance runs out.

Out of the box the server runs in **demo-payment mode** (a "demo top-up" button,
no real money) so you can test everything. To switch on real PayPal payments:

1. Create a PayPal **Business** account, then an app at developer.paypal.com
   → you get a **Client ID** and **Secret** (sandbox and live pairs).
2. Set environment variables on your host:
   `PAYPAL_CLIENT_ID=...  PAYPAL_SECRET=...  PAYPAL_ENV=live` (omit `PAYPAL_ENV`
   or set anything else to use the sandbox for testing).
3. Restart. The Balance page now shows real PayPal checkout buttons; payments
   are captured and verified server-side (`/v2/checkout/orders` API) before the
   balance is credited, and the demo button disables itself automatically.

Test with sandbox credentials + a sandbox buyer account first, then switch to live.

### Crypto payments (BTC, ETH, USDT, SOL)

Balance top-ups can also be paid in cryptocurrency via **Coinbase Commerce**:

1. Create a free account at commerce.coinbase.com and generate an API key.
2. Set `COINBASE_COMMERCE_API_KEY=...` on your host and restart.
3. The Balance page now shows a "Paguaj me kriptomonedhë" option. It opens
   Coinbase Commerce's hosted checkout where the buyer picks the coin
   (BTC, ETH, USDT, SOL and others enabled in your dashboard) and pays from
   any wallet. Back on the site, "Kontrollo pagesën" verifies the charge
   **server-side against the Coinbase API** and credits the balance exactly
   once per charge — no funds are credited on the user's word alone.

Notes: on-chain confirmation can take a few minutes depending on the coin;
the user can re-check until it confirms. Coinbase Commerce settles what you
receive; consult your accountant on crypto bookkeeping/taxes in Albania.
PayPal and crypto can both be enabled at the same time — users choose.

Once hosted (i.e. with internet access to tile servers), the map automatically uses:
- **Streets**: OpenStreetMap raster tiles — full Albania, every street and building
- **Satellite**: Esri World Imagery — real satellite/aerial photos
- **Address search / reverse geocoding**: OSM Nominatim, limited to Albania

Without network access to those services (like in the sandboxed preview), the map
falls back to the embedded OSM data in `data.js`.

### Production notes (before real launch)

1. **Scale the database when traffic grows.** The JSON-file store in `server.js` is solid
   for hundreds of listings; when you outgrow it, swap the small `loadDb/saveDb` layer for
   Postgres/SQLite — the API surface stays the same.
2. **Serve over HTTPS** (Render/Railway do this automatically; on a VPS put Caddy or
   nginx + Let's Encrypt in front) and then add `Secure` to the session cookie in server.js.
3. **Tile usage policies.** OpenStreetMap's public tile server is fine for development but
   not for production traffic. For launch, generate your own Albania vector tiles (free):
   `planetiler` over Geofabrik's `albania-latest.osm.pbf` → one `.pmtiles` file served from
   your CDN. Esri imagery requires attribution (already included) — check their terms for
   commercial volume, or use a paid imagery provider (MapTiler/Mapbox satellite).
4. **Nominatim** public instance has a 1 req/s fair-use limit — self-host it or use a
   commercial geocoder at scale.
5. **Photos** are stored as base64 in localStorage in the demo; move to object storage
   (S3/R2) via the backend.

## Email service (verification, password reset, saved-search alerts)

Set `RESEND_API_KEY` (free tier at resend.com) and `EMAIL_FROM` to enable real
emails. Users must verify their email before publishing; password reset works
by emailed code; users with saved searches get an email when a matching
listing is published. **Without the key, the site runs in demo mode**: the
verification/reset codes are shown directly in the UI so every flow stays testable.

## Admin

Set `ADMIN_EMAILS=you@domain.com` (comma-separated for several). If unset, the
first registered user is the admin (fine for demos — always set it in production).
Admins get an Admin panel: stats (users, listings, promotion revenue), listing
moderation (delete), and user suspension (banning unpublishes their listings).

## SEO

Each published listing is served as a crawlable page at `/prona/<id>` with meta
tags and OpenGraph image, plus `/sitemap.xml` and `/robots.txt` — submit the
sitemap in Google Search Console after launch.

## Other features

Favorites (♥), saved searches with in-app new-match badges and email alerts,
photo lightbox, map pin clustering, similar properties, WhatsApp sharing, and
an SQ/EN language toggle. Photos are stored as files under `data/photos/`
(served with long cache headers), not inside the database.

## Agency subscription plans & lead statistics

**Plans** (charged monthly from the user's wallet balance, no external setup needed):
Falas (5 active listings) · Pro €29/mo (30 listings + daily statistics) ·
Premium €79/mo (unlimited + PREMIUM badge on listings + statistics).
Limits are enforced server-side at publish; renewals run automatically from
balance and downgrade gracefully to Falas when balance runs out (existing
listings stay published). Users manage plans at `#/plans`.
Prices are set in the `PLANS` constant at the top of the plans section in
`server.js` and mirrored in `app.js` — change both to reprice.

**Lead statistics**: every listing tracks views, phone-number reveals and
WhatsApp clicks (30 days of daily buckets, totals forever). Owners see
counters in "Pronat e mia"; Pro/Premium unlock the daily chart. Stats are
private to the owner — the public API strips them. This is your sales tool:
"your listings got N phone reveals this month" is what convinces agencies
to subscribe.
