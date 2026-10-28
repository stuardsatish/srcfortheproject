# Security Notes & Operational Runbook

This document records the security controls added in the hardening pass and the
operational levers available to admins.

## Server-side enforcement (Supabase Edge Functions)

All money/data mutations are server-authoritative via the Supabase service-role client:

- **Auth:** every sensitive route verifies a Supabase JWT (`_shared/auth.ts:requireAuth`); `userId` is taken from the verified token, never the body.
- **Pricing:** Razorpay orders are priced from the catalog server-side. The WhatsApp manual-order route (`orders-manual-create`) also recomputes item prices from the catalog and refuses a total that disagrees with the pasted message unless the admin explicitly confirms (`allowPriceOverride`).
- **Rate limiting:** per-user limits on `create-order`, `verify`, `reviews/create`, `promo/validate`. The limiter now **fails closed** (denies) on error for cost-bearing routes.
- **Global cap:** hard ceiling on Razorpay order creations per UTC day (`ORDERS_DAILY_CAP`, default 2000).
- **CORS:** restricted to known origins (see `ALLOWED_ORIGINS`), not reflect-any.
- **Headers:** CSP/HSTS/nosniff/frame-deny applied on every Edge Function response.
- **Cleanup:** scheduled function purges abandoned pending orders regularly.

## Kill switch (no redeploy needed)

Edit the Supabase **`settings`** table row with `id = 'security'`:

| Field (inside `data` jsonb) | Effect |
|---|---|
| `allDisabled: true` | Blocks checkout, manual orders, and reviews immediately. |
| `ordersEnabled: false` | Blocks Razorpay checkout + manual order creation. |
| `reviewsEnabled: false` | Blocks review submission. |

Missing row / missing field = feature enabled (default-on). Only admins can write
`settings` (Supabase RLS policies).

## Blocking an abusive user (no redeploy needed)

Set the user's `profiles` row:
- `status = 'blocked'` or `status = 'suspended'`

Blocked users are refused on `create-order` and `reviews/create`.

## Deploy checklist

```bash
# 1. Set secrets via Supabase CLI (do NOT commit real values)
supabase secrets set RAZORPAY_KEY_SECRET=XXXX
supabase secrets set RAZORPAY_WEBHOOK_SECRET=XXXX

# 2. Deploy Edge Functions
supabase functions deploy

# 3. Deploy frontend to Vercel
npm run build && npx vercel --prod
```

## Still requires manual/console action

- **Add reCAPTCHA to signup** to stop automated account creation.
- **Wire error monitoring** (Sentry / Supabase Logs) into the app and functions.
- **Set budget alerts** on Supabase + Razorpay.
- **`xlsx`**: only used for client-side spreadsheet *export* (never parsing untrusted files), so the known CVEs are not reachable. To clear `npm audit` entirely, replace the npm package with the vendor build from https://cdn.sheetjs.com.