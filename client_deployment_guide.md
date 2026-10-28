# E-Commerce Platform — Multi-Client Deployment Guide

> **Author:** For the project owner (you) to refer to when selling/deploying this platform to new clients.
> **Date:** August 2026

---

## Table of Contents

1. [Overview & Architecture](#overview)
2. [PART 1 — Deploying to a New Client (Their Own Supabase)](#part-1)
   - [Step 1: Code Changes](#step-1-code-changes)
   - [Step 2: Client Creates Supabase Project](#step-2-supabase-project)
   - [Step 3: Database Tables Setup (SQL)](#step-3-tables)
   - [Step 4: RLS Policies Setup (SQL)](#step-4-rls)
   - [Step 5: RPC Functions Setup (SQL)](#step-5-rpc)
   - [Step 6: Deploy Edge Functions](#step-6-edge-functions)
   - [Step 7: Set Edge Function Secrets](#step-7-secrets)
   - [Step 8: Update CORS Origins in Dashboard Bundles](#step-8-cors)
   - [Step 9: Initial Seed Data](#step-9-seed)
   - [Step 10: Deploy the Frontend](#step-10-frontend)
3. [PART 2 — Aggregating All Client Data into Your Master Supabase](#part-2)
   - [Strategy A: Webhook Mirror (Recommended)](#strategy-a)
   - [Strategy B: Postgres Foreign Data Wrapper](#strategy-b)
   - [Strategy C: Scheduled Sync Function](#strategy-c)
4. [Quick Reference Checklist](#checklist)
5. [Secrets & Keys Reference](#secrets-reference)

---

<a name="overview"></a>
## 1. Overview & Architecture

### What This Platform Consists Of

| Layer | Technology | Where it lives |
|---|---|---|
| Frontend | React + Vite | Deployed to Vercel |
| Database + Auth | Supabase (PostgreSQL + Auth) | Supabase project |
| Serverless functions | Supabase Edge Functions (Deno) | Same Supabase project |
| Payment gateway | Razorpay | Client's own Razorpay account |
| Config | `.env` file | Build-time only, never committed |

### How the Code Connects to Supabase

There are **only 2 places** in the code that connect to Supabase:

1. **Frontend** → [`src/context/SupabaseConfig.js`](file:///d:/Working%20Template/wroking%20template/e%20comeerce%20supa%20base%2015%20aug%20v2/src/context/SupabaseConfig.js)
   - Uses `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from `.env`
2. **Edge Functions** → [`supabase/functions/_shared/clients.ts`](file:///d:/Working%20Template/wroking%20template/e%20comeerce%20supa%20base%2015%20aug%20v2/supabase/functions/_shared/clients.ts)
   - Auto-reads `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` from Supabase platform secrets (injected automatically by Supabase — you don't set these manually)

---

<a name="part-1"></a>
## PART 1 — Deploying to a New Client

> [!IMPORTANT]
> Every client gets their **own Supabase project**. This means their data is completely isolated — users, orders, products, reviews — all in their own database. You give them a separate hosted version of the frontend pointing at their Supabase.

---

<a name="step-1-code-changes"></a>
### Step 1: Code Changes Required

> [!NOTE]
> This is **the only code change you need to make per client**. Everything else is configuration.

**File: `.env`** (create this fresh for each client build)

```bash
# Client: ABC Sweets Pvt Ltd
VITE_SUPABASE_URL=https://<CLIENT-PROJECT-REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<CLIENT-ANON-KEY>
```

Replace the values with the client's Supabase project URL and anon key (obtained in Step 2).

**That's it for code changes.** The frontend reads these env vars at build time. Every API call, auth flow, and edge function call automatically goes to the client's Supabase.

> [!WARNING]
> NEVER commit `.env` to git. It's already in `.gitignore`. Create `.env` fresh for each client build.

---

<a name="step-2-supabase-project"></a>
### Step 2: Client Creates a Supabase Project

Guide the client (or do this for them) to:

1. Go to [https://supabase.com](https://supabase.com) → **New Project**
2. Set **Organization**, **Project Name** (e.g., "abc-sweets"), **Database Password**, **Region** (choose India for Indian clients)
3. Wait ~2 minutes for provisioning
4. Go to **Project Settings → API**:
   - Copy **Project URL** → this is `VITE_SUPABASE_URL`
   - Copy **anon/public key** → this is `VITE_SUPABASE_ANON_KEY`
   - Copy **service_role key** → this is needed for secrets (Step 7), **never expose this publicly**

---

<a name="step-3-tables"></a>
### Step 3: Database Tables Setup

Go to **Supabase Dashboard → SQL Editor** and run the following SQL in order.

#### 3.1 — Profiles Table (extends Supabase Auth users)

```sql
-- Profiles: one row per auth.users row
CREATE TABLE public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text,
  email       text,
  phone       text,
  address     text,
  role        text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'suspended')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Auto-create profile row when a user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  INSERT INTO public.profiles (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
```

#### 3.2 — Products Table

```sql
CREATE TABLE public.products (
  id            text PRIMARY KEY,
  title         text NOT NULL,
  description   text,
  price         numeric(12,2) NOT NULL DEFAULT 0,
  original_price numeric(12,2),
  category      text,
  stock         integer NOT NULL DEFAULT 0,
  image         text,
  thumbnail     text,
  images        jsonb,
  tags          text[],
  is_active     boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
```

#### 3.3 — Orders & Order Items Tables

```sql
CREATE TABLE public.orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_order_id text,
  order_status      text NOT NULL DEFAULT 'placed',
  payment_status    text NOT NULL DEFAULT 'pending',
  payment_method    text,
  subtotal          numeric(12,2),
  discount          numeric(12,2) DEFAULT 0,
  delivery_fee      numeric(12,2) DEFAULT 0,
  total             numeric(12,2),
  promo_code        text,
  shipping_address  jsonb,
  razorpay_order_id text,
  razorpay_payment_id text,
  notes             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.order_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id  text NOT NULL,
  title       text,
  price       numeric(12,2),
  quantity    integer NOT NULL DEFAULT 1,
  thumbnail   text
);

CREATE INDEX idx_orders_user_id ON public.orders(user_id);
CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);
```

#### 3.4 — Reviews Table

```sql
CREATE TABLE public.reviews (
  id          text PRIMARY KEY,            -- format: userId_orderId_productId
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id    uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id  text NOT NULL,
  rating      integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reviews_product_id ON public.reviews(product_id);
CREATE INDEX idx_reviews_user_id ON public.reviews(user_id);
```

#### 3.5 — Cart Table

```sql
CREATE TABLE public.cart_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id  text NOT NULL,
  quantity    integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, product_id)
);
```

#### 3.6 — Promo Codes Table

```sql
CREATE TABLE public.promo_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text UNIQUE NOT NULL,
  discount_type   text NOT NULL CHECK (discount_type IN ('percentage', 'flat')),
  discount_value  numeric(12,2) NOT NULL,
  min_order_value numeric(12,2) DEFAULT 0,
  max_discount    numeric(12,2),
  usage_limit     integer,
  used_count      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  expiry_date     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

#### 3.7 — Settings Table

```sql
CREATE TABLE public.settings (
  id    text PRIMARY KEY,
  data  jsonb NOT NULL DEFAULT '{}'
);

-- Insert default security settings
INSERT INTO public.settings (id, data) VALUES
  ('security', '{"reviewsEnabled": true, "ordersEnabled": true, "allDisabled": false}'),
  ('store', '{"storeName": "My Store", "currency": "INR", "deliveryFee": 0}');
```

#### 3.8 — Rate Limits Table

```sql
CREATE TABLE public.rate_limits (
  key         text PRIMARY KEY,
  count       integer NOT NULL DEFAULT 0,
  window_end  timestamptz NOT NULL
);
```

#### 3.9 — Pending Orders Table (used by payment flow)

```sql
CREATE TABLE public.pending_orders (
  razorpay_order_id text PRIMARY KEY,
  user_id           uuid NOT NULL,
  payload           jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

---

<a name="step-4-rls"></a>
### Step 4: Row Level Security (RLS) Policies

Run this in **SQL Editor** after creating tables.

```sql
-- Enable RLS on all tables
ALTER TABLE public.profiles     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_codes  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_orders ENABLE ROW LEVEL SECURITY;

-- ===== PROFILES =====
CREATE POLICY "Users can read their own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins can read all profiles"
  ON public.profiles FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
CREATE POLICY "Admins can update all profiles"
  ON public.profiles FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ===== PRODUCTS =====
CREATE POLICY "Anyone can read active products"
  ON public.products FOR SELECT USING (is_active = true OR EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'
  ));
CREATE POLICY "Admins can insert products"
  ON public.products FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
CREATE POLICY "Admins can update products"
  ON public.products FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
CREATE POLICY "Admins can delete products"
  ON public.products FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ===== ORDERS =====
CREATE POLICY "Users can read their own orders"
  ON public.orders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins can read all orders"
  ON public.orders FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
CREATE POLICY "Admins can update orders"
  ON public.orders FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
-- Orders can only be INSERTED by Edge Functions (service role), not by clients

-- ===== ORDER ITEMS =====
CREATE POLICY "Users can read their own order items"
  ON public.order_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid()));
CREATE POLICY "Admins can read all order items"
  ON public.order_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ===== REVIEWS =====
CREATE POLICY "Anyone can read reviews"
  ON public.reviews FOR SELECT USING (true);
-- No INSERT policy — only Edge Functions (service role) can insert reviews

-- ===== CART =====
CREATE POLICY "Users can manage their own cart"
  ON public.cart_items FOR ALL USING (auth.uid() = user_id);

-- ===== PROMO CODES =====
CREATE POLICY "Anyone authenticated can read active promos"
  ON public.promo_codes FOR SELECT USING (auth.uid() IS NOT NULL AND is_active = true);
CREATE POLICY "Admins can manage promo codes"
  ON public.promo_codes FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ===== SETTINGS =====
CREATE POLICY "Anyone can read settings"
  ON public.settings FOR SELECT USING (true);
CREATE POLICY "Admins can update settings"
  ON public.settings FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ===== RATE LIMITS — Edge Functions only (service role) =====
-- No policies needed — service role bypasses RLS

-- ===== PENDING ORDERS — Edge Functions only =====
-- No policies needed — service role bypasses RLS
```

---

<a name="step-5-rpc"></a>
### Step 5: RPC Functions (Stored Procedures)

```sql
-- Rate limit check RPC (called by Edge Functions via service role)
CREATE OR REPLACE FUNCTION public.rate_limit_check(
  p_key text,
  p_max integer,
  p_window_seconds integer
) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_now timestamptz := now();
  v_window_end timestamptz;
  v_count integer;
BEGIN
  SELECT window_end, count
    INTO v_window_end, v_count
    FROM public.rate_limits
   WHERE key = p_key;

  IF v_window_end IS NULL OR v_now > v_window_end THEN
    -- New window
    INSERT INTO public.rate_limits (key, count, window_end)
    VALUES (p_key, 1, v_now + (p_window_seconds || ' seconds')::interval)
    ON CONFLICT (key) DO UPDATE
      SET count = 1, window_end = v_now + (p_window_seconds || ' seconds')::interval;
    RETURN true;
  ELSIF v_count < p_max THEN
    UPDATE public.rate_limits SET count = count + 1 WHERE key = p_key;
    RETURN true;
  ELSE
    RETURN false;
  END IF;
END;
$$;

-- Revoke from anon/authenticated — only Edge Functions (service role) can call this
REVOKE EXECUTE ON FUNCTION public.rate_limit_check FROM anon, authenticated;
```

---

<a name="step-6-edge-functions"></a>
### Step 6: Deploy Edge Functions

You have two methods to deploy Edge Functions.

#### Method A — Using Supabase Dashboard (Easiest, no CLI needed)

Use the pre-built **dashboard bundle files** located in `supabase/dashboard-bundles/`. Each file is a single self-contained TypeScript file.

1. Go to **Supabase Dashboard → Edge Functions → Deploy a new function**
2. For each function below, create with the exact name and paste the bundle file content:

| Function Name | Bundle File |
|---|---|
| `payment-create-order` | `supabase/dashboard-bundles/payment-create-order.ts` |
| `payment-verify` | `supabase/dashboard-bundles/payment-verify.ts` |
| `payment-webhook` | `supabase/dashboard-bundles/payment-webhooks.ts` |
| `payment-cod-create` | `supabase/dashboard-bundles/payment-cod-create.ts` |
| `reviews-create` | `supabase/dashboard-bundles/reviews-create.ts` |
| `promo-validate` | `supabase/dashboard-bundles/promo-validate.ts` |
| `orders-manual-create` | `supabase/dashboard-bundles/orders-manual-create.ts` |
| `orders-billing-create` | `supabase/dashboard-bundles/orders-billing-create.ts` |
| `orders-bulk-import` | `supabase/dashboard-bundles/orders-bulk-imports.ts` |

3. For `payment-webhook` function only: **Disable JWT verification**
   - After creating it, click the function → Settings → Uncheck "Verify JWT"

#### Method B — Using Supabase CLI

```bash
# Install CLI
npm install -g supabase

# Login
supabase login

# Link to client's project
supabase link --project-ref <CLIENT-PROJECT-REF>

# Deploy all functions
supabase functions deploy payment-create-order
supabase functions deploy payment-verify
supabase functions deploy payment-webhook --no-verify-jwt
supabase functions deploy payment-cod-create
supabase functions deploy reviews-create
supabase functions deploy promo-validate
supabase functions deploy orders-manual-create
supabase functions deploy orders-billing-create
supabase functions deploy orders-bulk-import
```

---

<a name="step-7-secrets"></a>
### Step 7: Set Edge Function Secrets

Go to **Supabase Dashboard → Edge Functions → Secrets** (or use CLI).

> [!CAUTION]
> These are SECRET values. Never put them in `.env`, never commit to git, never send in chat.

#### Via Dashboard

Go to **Project Settings → Edge Functions → Manage secrets** and add:

| Secret Name | Value | Where to get it |
|---|---|---|
| `RAZORPAY_KEY_ID` | `rzp_live_XXXX` | Client's Razorpay Dashboard → API Keys |
| `RAZORPAY_KEY_SECRET` | `XXXX` | Client's Razorpay Dashboard → API Keys |
| `RAZORPAY_WEBHOOK_SECRET` | `XXXX` | Client's Razorpay Dashboard → Webhooks |
| `ALLOWED_ORIGINS` | `https://client-domain.com` | Client's deployed frontend URL |

> [!NOTE]
> `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are automatically injected by Supabase into Edge Functions — you do NOT need to set these manually.

#### Via CLI

```bash
supabase secrets set RAZORPAY_KEY_ID=rzp_live_XXXX
supabase secrets set RAZORPAY_KEY_SECRET=XXXX
supabase secrets set RAZORPAY_WEBHOOK_SECRET=XXXX
supabase secrets set ALLOWED_ORIGINS="https://client-domain.com,http://localhost:5173"
```

---

<a name="step-8-cors"></a>
### Step 8: Update CORS Origins in Dashboard Bundles

> [!IMPORTANT]
> The dashboard bundle files hardcode CORS origins. Before deploying them to a new client, update the `DEFAULT_ORIGINS` array at the top of **each** dashboard bundle file with the client's domain.

In every `supabase/dashboard-bundles/*.ts` file, find and update:

```typescript
// BEFORE (your demo domains)
const DEFAULT_ORIGINS = [
  "https://e-commerce-demo-website1.web.app",
  "https://my-sweet-bec4a.web.app",
  "http://localhost:5173",
];

// AFTER (client's domains)
const DEFAULT_ORIGINS = [
  "https://abc-sweets.vercel.app",       // client's Vercel URL
  "https://abcsweets.com",               // client's custom domain
  "http://localhost:5173",               // keep for local dev
];
```

Or better — set the `ALLOWED_ORIGINS` secret (Step 7) so you don't have to modify bundle files. If the secret exists, it overrides `DEFAULT_ORIGINS` automatically.

---

<a name="step-9-seed"></a>
### Step 9: Initial Seed Data

After tables are created, set up the first admin user:

1. Have the client sign up on the app (or create them via **Authentication → Users → Invite**)
2. Go to **SQL Editor** and run:

```sql
-- Replace with the client's admin email
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'admin@clientdomain.com';
```

3. Also insert initial settings if not already done:

```sql
INSERT INTO public.settings (id, data) VALUES
  ('store', '{
    "storeName": "ABC Sweets",
    "currency": "INR",
    "deliveryFee": 50,
    "freeDeliveryAbove": 500
  }')
ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data;
```

---

<a name="step-10-frontend"></a>
### Step 10: Deploy the Frontend

```bash
# In the project root
# 1. Create .env with client's Supabase credentials
echo "VITE_SUPABASE_URL=https://<client-ref>.supabase.co" > .env
echo "VITE_SUPABASE_ANON_KEY=<client-anon-key>" >> .env

# 2. Build
npm run build

# 3. Deploy to Vercel
npx vercel --prod
```

Set the **Razorpay Key ID** in the frontend environment too if it's used directly:
```
VITE_RAZORPAY_KEY_ID=rzp_live_XXXX
```

Also configure **Supabase Auth → URL Configuration**:
- **Site URL**: `https://client-domain.com`
- **Redirect URLs**: `https://client-domain.com/**`

---

<a name="part-2"></a>
## PART 2 — Aggregating All Client Data in Your Master Supabase

> You want: 10 clients → 10 separate Supabase projects (each client's data is isolated) → AND all 10 clients' data is also mirrored into YOUR single master Supabase so you can see everything.

Here are 3 strategies, from easiest to most advanced.

---

<a name="strategy-a"></a>
### Strategy A — Webhook Mirror (Recommended )

**How it works:** Each client's Supabase project fires a webhook on key events (new order, new user, etc.). Your master Supabase has an Edge Function that receives these webhooks and writes the data into your master database.

```
Client 1 Supabase  ──webhook──►  Your Master Edge Function  ──► Your Master DB
Client 2 Supabase  ──webhook──►  Your Master Edge Function  ──► Your Master DB
Client 3 Supabase  ──webhook──►  Your Master Edge Function  ──► Your Master DB
```

#### Master Database Tables (in YOUR Supabase)

```sql
-- Master table: tracks all clients
CREATE TABLE master.clients (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,          -- "ABC Sweets"
  slug        text UNIQUE NOT NULL,   -- "abc-sweets"
  supabase_url text,
  webhook_secret text NOT NULL,       -- used to verify incoming webhooks
  created_at  timestamptz DEFAULT now()
);

-- Master orders table (mirrors all client orders)
CREATE TABLE master.orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES master.clients(id),
  client_order_id uuid NOT NULL,      -- original order ID from client's DB
  user_email      text,
  total           numeric(12,2),
  order_status    text,
  payment_method  text,
  created_at      timestamptz,
  synced_at       timestamptz DEFAULT now()
);

-- Master revenue summary (optional, for dashboard)
CREATE TABLE master.daily_revenue (
  client_id  uuid REFERENCES master.clients(id),
  date       date,
  revenue    numeric(12,2) DEFAULT 0,
  orders_count integer DEFAULT 0,
  PRIMARY KEY (client_id, date)
);
```

#### Master Edge Function: `sync-client-data`

Create this function in YOUR master Supabase:

```typescript
// In your MASTER Supabase: Edge Function named "sync-client-data"
import { createClient } from "npm:@supabase/supabase-js@2";

const masterSupabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

Deno.serve(async (req) => {
  // 1. Identify which client sent this webhook
  const clientSlug = new URL(req.url).searchParams.get("client");
  
  // 2. Verify webhook secret
  const signature = req.headers.get("x-webhook-secret");
  const { data: client } = await masterSupabase
    .from("clients")
    .select("id, webhook_secret")
    .eq("slug", clientSlug)
    .single();
  
  if (!client || signature !== client.webhook_secret) {
    return new Response("Unauthorized", { status: 401 });
  }

  // 3. Parse event
  const body = await req.json();
  const { type, record } = body; // Supabase webhook payload format

  // 4. Mirror into master DB
  if (type === "INSERT" && record) {
    await masterSupabase.from("orders").insert({
      client_id: client.id,
      client_order_id: record.id,
      user_email: record.user_email,
      total: record.total,
      order_status: record.order_status,
      payment_method: record.payment_method,
      created_at: record.created_at,
    });
  }

  return new Response("OK", { status: 200 });
});
```

#### Setup Webhooks in Each Client's Supabase

1. Go to **Client's Supabase → Database → Webhooks → Create Webhook**
2. Set:
   - **Name**: `sync-to-master-orders`
   - **Table**: `orders`
   - **Events**: INSERT, UPDATE
   - **URL**: `https://<YOUR-MASTER-PROJECT>.supabase.co/functions/v1/sync-client-data?client=abc-sweets`
   - **HTTP Headers**: `x-webhook-secret: <their-webhook-secret>`

Repeat for each client you onboard.

---

<a name="strategy-b"></a>
### Strategy B — Postgres Foreign Data Wrapper (FDW)

> [!NOTE]
> This is an advanced approach. Requires Supabase Pro plan on client projects.

**How it works:** Your master Supabase connects directly to each client's PostgreSQL via Foreign Data Wrapper. You can `SELECT` from client tables as if they were local.

```sql
-- In YOUR master Supabase SQL Editor:

-- Install FDW extension
CREATE EXTENSION IF NOT EXISTS postgres_fdw;

-- Create server connection for Client 1
CREATE SERVER client1_server
  FOREIGN DATA WRAPPER postgres_fdw
  OPTIONS (host 'db.<CLIENT1-REF>.supabase.co', port '5432', dbname 'postgres');

CREATE USER MAPPING FOR current_user
  SERVER client1_server
  OPTIONS (user 'postgres', password '<CLIENT1-DB-PASSWORD>');

-- Import their orders table
IMPORT FOREIGN SCHEMA public LIMIT TO (orders, order_items)
  FROM SERVER client1_server INTO client1_schema;

-- Now you can query:
SELECT 'ABC Sweets' as client, * FROM client1_schema.orders;
```

**Pros:** Real-time data, no webhook setup.
**Cons:** Requires db password of each client (security risk), complex to manage at scale.

---

<a name="strategy-c"></a>
### Strategy C — Scheduled Sync Function

**How it works:** A cron job in your master Supabase runs every hour, calls each client's Supabase API, reads new orders, and writes them to your master DB.

```typescript
// Master Supabase Edge Function: "scheduled-sync"
// Set as a cron job: every hour

const CLIENTS = [
  { name: "ABC Sweets", url: "https://abc.supabase.co", key: "anon-key-abc", slug: "abc" },
  { name: "XYZ Foods",  url: "https://xyz.supabase.co", key: "anon-key-xyz", slug: "xyz" },
];

Deno.serve(async () => {
  for (const client of CLIENTS) {
    const clientSupabase = createClient(client.url, client.key);
    const masterSupabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Fetch last sync timestamp for this client
    const { data: syncState } = await masterSupabase
      .from("sync_state")
      .select("last_synced_at")
      .eq("client_slug", client.slug)
      .single();

    const since = syncState?.last_synced_at ?? "2020-01-01";

    // Fetch new orders from client
    const { data: orders } = await clientSupabase
      .from("orders")
      .select("id, total, order_status, created_at")
      .gt("created_at", since);

    // Write to master
    if (orders?.length) {
      await masterSupabase.from("master_orders").upsert(
        orders.map(o => ({ ...o, client_slug: client.slug }))
      );
    }

    // Update sync timestamp
    await masterSupabase.from("sync_state")
      .upsert({ client_slug: client.slug, last_synced_at: new Date().toISOString() });
  }
  return new Response("Sync complete");
});
```

**Pros:** Simple, no FDW, just REST API calls.
**Cons:** Not real-time (up to 1 hour delay), anon key of client is stored in your function.

---

<a name="checklist"></a>
## 4. Quick Reference Checklist (Per Client)

```
DEPLOYMENT CHECKLIST — Client: _________________________

SUPABASE SETUP
[ ] Client creates Supabase project
[ ] Collect: Project URL, Anon Key, Service Role Key
[ ] Run: Table creation SQL (Step 3.1–3.9)
[ ] Run: RLS policies SQL (Step 4)
[ ] Run: RPC functions SQL (Step 5)

EDGE FUNCTIONS
[ ] Deploy: payment-create-order
[ ] Deploy: payment-verify
[ ] Deploy: payment-webhook (JWT disabled)
[ ] Deploy: payment-cod-create
[ ] Deploy: reviews-create
[ ] Deploy: promo-validate
[ ] Deploy: orders-manual-create
[ ] Deploy: orders-billing-create
[ ] Deploy: orders-bulk-import

SECRETS
[ ] Set: RAZORPAY_KEY_ID
[ ] Set: RAZORPAY_KEY_SECRET
[ ] Set: RAZORPAY_WEBHOOK_SECRET
[ ] Set: ALLOWED_ORIGINS (client's domain)

FRONTEND
[ ] Create .env with client's VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
[ ] Update package.json "name" if needed
[ ] Run: npm run build
[ ] Deploy to Vercel

SUPABASE AUTH
[ ] Set Site URL to client's domain
[ ] Set Redirect URLs

POST-DEPLOY
[ ] Create first admin user
[ ] Set admin role in profiles table
[ ] Add initial store settings
[ ] Test: sign up → add product → place order → leave review

MASTER SYNC (if using Strategy A)
[ ] Create client entry in master.clients table
[ ] Set up webhook in client's Supabase pointing to master sync function
```

---

<a name="secrets-reference"></a>
## 5. Secrets & Keys Reference

| Key | Where | Type | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Frontend `.env` | Public | Safe to expose — used client-side |
| `VITE_SUPABASE_ANON_KEY` | Frontend `.env` | Public | Safe to expose — RLS protects data |
| `VITE_RAZORPAY_KEY_ID` | Frontend `.env` | Public | Only the key ID, not secret |
| `SUPABASE_SERVICE_ROLE_KEY` | Edge Function Secret | **PRIVATE** | Bypasses RLS — never expose |
| `RAZORPAY_KEY_SECRET` | Edge Function Secret | **PRIVATE** | Used for payment verification |
| `RAZORPAY_WEBHOOK_SECRET` | Edge Function Secret | **PRIVATE** | Used for webhook HMAC verification |
| `ALLOWED_ORIGINS` | Edge Function Secret | Config | Comma-separated list of allowed domains |

> [!CAUTION]
> The `SUPABASE_SERVICE_ROLE_KEY` is extremely sensitive. Anyone with it can read/write all data bypassing all RLS rules. Never put it in frontend code, never commit it to git, never share it in chat.

---

*Document generated for: E-Commerce Platform v2 (Supabase backend)*
*Based on project at: `d:\Working Template\wroking template\e comeerce supa base 15 aug v2`*