# Production Client Deployment Guide
### E-Commerce Platform - Complete Step-by-Step Checklist

> **Purpose:** Follow this document from top to bottom every time you deploy this project for a new client.
> When you finish all steps, the client has a 100% production-ready, live e-commerce store.

---

## BEFORE YOU START - What You Need From the Client

Collect these details from the client before doing anything:

```
Client Name:          _________________________________
Store Name:           _________________________________  (shown in Razorpay popup)
Client Domain:        _________________________________  (e.g. abcsweets.com or will use Vercel URL)
Admin Email:          _________________________________  (who manages the store)
Razorpay Account:     Does client have one? YES / NO
```

> [!IMPORTANT]
> If the client does NOT have a Razorpay account, they need to create one at
> https://razorpay.com and complete KYC before you can go live. This can take 1-3 days.

---

## PHASE 1 - CODE CHANGES (Do This First, Before Anything Else)

### 1.1 - The Only File You Must Edit Per Client

**File:** `src/pages/CartPage/CartPage.jsx`
**Line:** ~323

Find this line:
```javascript
// BEFORE (change this)
name: "Nexus Commerce",
```

Change it to the client's store name:
```javascript
// AFTER
name: "ABC Sweets",
```

> [!NOTE]
> This is the store name that appears in the Razorpay payment popup window that customers see.
> This is the ONLY code change needed per client. Everything else is configuration.

### 1.2 - Create the `.env` File

In the project root folder, create a new `.env` file (delete the old one if it exists):

```bash
# .env - Client: ABC Sweets
VITE_SUPABASE_URL=https://<CLIENT-PROJECT-REF>.supabase.co
VITE_SUPABASE_ANON_KEY=<CLIENT-ANON-KEY>
```

You will get these values in Phase 2 (Supabase setup).

> [!CAUTION]
> NEVER commit `.env` to git. It is already in `.gitignore`. Always create it fresh per client.

---

## PHASE 2 - SUPABASE PROJECT SETUP

### 2.1 - Create Supabase Project

1. Go to **https://supabase.com** -> Sign in -> **New Project**
2. Fill in:
   - **Organization**: your org (or client's if they have an account)
   - **Project Name**: `abc-sweets` (lowercase, no spaces)
   - **Database Password**: Generate a strong one -> **SAVE THIS PASSWORD**
   - **Region**: `ap-south-1` (Mumbai) - best for Indian clients
3. Click **Create new project** - wait 2 minutes for setup

4. Go to **Project Settings -> API** and copy:
   - **Project URL** -> paste into `.env` as `VITE_SUPABASE_URL`
   - **anon/public** key -> paste into `.env` as `VITE_SUPABASE_ANON_KEY`
   - **service_role** key -> save separately (needed for secrets, never goes in `.env`)

---

### 2.2 - Create All Database Tables

Go to **Supabase Dashboard -> SQL Editor -> New Query**, paste and run each block:

#### TABLE 1: Profiles

```sql
CREATE TABLE public.profiles (
  id          uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        text,
  email       text,
  phone       text,
  address     text,
  role        text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status      text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'blocked', 'suspended')),
  created_at  timestamptz NOT NULL DEFAULT now()
);

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

#### TABLE 2: Products

```sql
CREATE TABLE public.products (
  id             text PRIMARY KEY,
  title          text NOT NULL,
  description    text,
  price          numeric(12,2) NOT NULL DEFAULT 0,
  original_price numeric(12,2),
  category       text,
  stock          integer NOT NULL DEFAULT 0,
  image          text,
  thumbnail      text,
  images         jsonb,
  tags           text[],
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
```

#### TABLE 3: Orders

```sql
CREATE TABLE public.orders (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  external_order_id   text,
  order_status        text NOT NULL DEFAULT 'placed',
  payment_status      text NOT NULL DEFAULT 'pending',
  payment_method      text,
  subtotal            numeric(12,2),
  discount            numeric(12,2) DEFAULT 0,
  delivery_fee        numeric(12,2) DEFAULT 0,
  total               numeric(12,2),
  promo_code          text,
  shipping_address    jsonb,
  razorpay_order_id   text,
  razorpay_payment_id text,
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_orders_user_id ON public.orders(user_id);
```

#### TABLE 4: Order Items

```sql
CREATE TABLE public.order_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id  text NOT NULL,
  title       text,
  price       numeric(12,2),
  quantity    integer NOT NULL DEFAULT 1,
  thumbnail   text
);

CREATE INDEX idx_order_items_order_id ON public.order_items(order_id);
```

#### TABLE 5: Reviews

```sql
CREATE TABLE public.reviews (
  id          text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  order_id    uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id  text NOT NULL,
  rating      integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_reviews_product_id ON public.reviews(product_id);
CREATE INDEX idx_reviews_user_id ON public.reviews(user_id);
```

#### TABLE 6: Cart Items

```sql
CREATE TABLE public.cart_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id  text NOT NULL,
  quantity    integer NOT NULL DEFAULT 1,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, product_id)
);
```

#### TABLE 7: Promo Codes

```sql
CREATE TABLE public.promo_codes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text UNIQUE NOT NULL,
  discount_type   text NOT NULL CHECK (discount_type IN ('percentage', 'flat')),
  discount_value  numeric(12,2) NOT NULL,
  min_order_value numeric(12,2) DEFAULT 0,
  max_discount    numeric(12,2),
  usage_limit     integer,
  used_count      integer NOT NULL DEFAULT 0,
  is_active       boolean NOT NULL DEFAULT true,
  expiry_date     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now()
);
```

#### TABLE 8: Settings

```sql
CREATE TABLE public.settings (
  id    text PRIMARY KEY,
  data  jsonb NOT NULL DEFAULT '{}'
);

INSERT INTO public.settings (id, data) VALUES
  ('security', '{"reviewsEnabled": true, "ordersEnabled": true, "allDisabled": false}'),
  ('store',    '{"storeName": "ABC Sweets", "currency": "INR", "deliveryFee": 0}'),
  ('payment',  '{"razorpayPayment": true, "codPayment": true, "whatsappPayment": false}');
```

#### TABLE 9: Rate Limits & Pending Orders

```sql
CREATE TABLE public.rate_limits (
  key         text PRIMARY KEY,
  count       integer NOT NULL DEFAULT 0,
  window_end  timestamptz NOT NULL
);

CREATE TABLE public.pending_orders (
  razorpay_order_id text PRIMARY KEY,
  user_id           uuid NOT NULL,
  payload           jsonb NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
```

---

### 2.3 - Set Up Row Level Security (RLS)

Run this in SQL Editor:

```sql
-- Enable RLS on all tables
ALTER TABLE public.profiles       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reviews        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cart_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_codes    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.settings       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rate_limits    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pending_orders ENABLE ROW LEVEL SECURITY;

-- PROFILES
CREATE POLICY "Users read own profile"
  ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile"
  ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Admins read all profiles"
  ON public.profiles FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
CREATE POLICY "Admins update all profiles"
  ON public.profiles FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- PRODUCTS
CREATE POLICY "Anyone reads active products"
  ON public.products FOR SELECT
  USING (is_active = true OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
CREATE POLICY "Admins insert products"
  ON public.products FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
CREATE POLICY "Admins update products"
  ON public.products FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
CREATE POLICY "Admins delete products"
  ON public.products FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ORDERS
CREATE POLICY "Users read own orders"
  ON public.orders FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins read all orders"
  ON public.orders FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
CREATE POLICY "Admins update orders"
  ON public.orders FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- ORDER ITEMS
CREATE POLICY "Users read own order items"
  ON public.order_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.user_id = auth.uid()));
CREATE POLICY "Admins read all order items"
  ON public.order_items FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- REVIEWS
CREATE POLICY "Anyone reads reviews"
  ON public.reviews FOR SELECT USING (true);

-- CART
CREATE POLICY "Users manage own cart"
  ON public.cart_items FOR ALL USING (auth.uid() = user_id);

-- PROMO CODES
CREATE POLICY "Auth users read active promos"
  ON public.promo_codes FOR SELECT USING (auth.uid() IS NOT NULL AND is_active = true);
CREATE POLICY "Admins manage promos"
  ON public.promo_codes FOR ALL
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));

-- SETTINGS
CREATE POLICY "Anyone reads settings"
  ON public.settings FOR SELECT USING (true);
CREATE POLICY "Admins update settings"
  ON public.settings FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin'));
```

---

### 2.4 - Create RPC Function

```sql
CREATE OR REPLACE FUNCTION public.rate_limit_check(
  p_key text, p_max integer, p_window_seconds integer
) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_now        timestamptz := now();
  v_window_end timestamptz;
  v_count      integer;
BEGIN
  SELECT window_end, count INTO v_window_end, v_count
  FROM public.rate_limits WHERE key = p_key;

  IF v_window_end IS NULL OR v_now > v_window_end THEN
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

REVOKE EXECUTE ON FUNCTION public.rate_limit_check FROM anon, authenticated;
```

---

## PHASE 3 - DEPLOY EDGE FUNCTIONS

Deploy all edge functions to the client's Supabase project using Supabase CLI:

```bash
npx supabase login
npx supabase functions deploy --project-ref <CLIENT-PROJECT-REF>
```

Or deploy manually via **Supabase Dashboard -> Edge Functions -> Deploy a new function**:

| # | Function Name (type exactly) | Bundle File to Copy |
|---|---|---|
| 1 | `payment-create-order` | `supabase/dashboard-bundles/payment-create-order.ts` |
| 2 | `payment-verify` | `supabase/dashboard-bundles/payment-verify.ts` |
| 3 | `payment-webhook` | `supabase/dashboard-bundles/payment-webhooks.ts` |
| 4 | `payment-cod-create` | `supabase/dashboard-bundles/payment-cod-create.ts` |
| 5 | `reviews-create` | `supabase/dashboard-bundles/reviews-create.ts` |
| 6 | `promo-validate` | `supabase/dashboard-bundles/promo-validate.ts` |
| 7 | `orders-manual-create` | `supabase/dashboard-bundles/orders-manual-create.ts` |
| 8 | `orders-billing-create` | `supabase/dashboard-bundles/orders-billing-create.ts` |
| 9 | `orders-bulk-import` | `supabase/dashboard-bundles/orders-bulk-imports.ts` |

> [!CAUTION]
> For `payment-webhook` ONLY - after deploying, click the function -> Settings tab ->
> **Disable "Verify JWT"**. Razorpay calls this endpoint directly, not your users.

---

## PHASE 4 - PRODUCTION RAZORPAY SETUP

### 4.1 - Get Production Keys from Razorpay

> [!IMPORTANT]
> Test keys (`rzp_test_...`) only work in test mode. You MUST use live keys for real money.

1. Log in to **https://dashboard.razorpay.com**
2. **Top-right corner** -> Toggle from **Test Mode** to **Live Mode**
3. Go to **Settings -> API Keys -> Generate Key**
4. You will see:
   - **Key ID**: starts with `rzp_live_XXXX` (this is public)
   - **Key Secret**: shown only once - **COPY AND SAVE IT NOW**

### 4.2 - Get Razorpay Webhook Secret

1. In Razorpay Dashboard -> **Settings -> Webhooks -> Add New Webhook**
2. Set **Webhook URL** to:
   ```
   https://<CLIENT-PROJECT-REF>.supabase.co/functions/v1/payment-webhook
   ```
3. Select Events: `payment.captured`, `payment.failed`
4. Set a **Secret** (any random string, e.g. `abc123xyz`) - save this
5. Click **Save**

### 4.3 - Set Secrets in Supabase (CRITICAL STEP)

Go to **Supabase Dashboard -> Project Settings -> Edge Functions -> Manage Secrets**

Add these 4 secrets:

| Secret Name | Value | Description |
|---|---|---|
| `RAZORPAY_KEY_ID` | `rzp_live_XXXXXXXXXXXX` | Live Key ID from Razorpay |
| `RAZORPAY_KEY_SECRET` | `XXXXXXXXXXXXXXXXXXXX` | Live Key Secret - never share |
| `RAZORPAY_WEBHOOK_SECRET` | `abc123xyz` | Secret you set in Razorpay webhook |
| `ALLOWED_ORIGINS` | `https://<client-url>.vercel.app,http://localhost:5173` | Update after getting Vercel URL |

> [!NOTE]
> `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are automatically
> available in Edge Functions - Supabase injects them. You do NOT set these manually.

---

## PHASE 5 - VERCEL HOSTING (Frontend)

### 5.1 - Build the Project Locally (Verification)

```powershell
npm run build
```
Verify that `dist/` is generated with 0 errors.

### 5.2 - Deploy to Vercel via GitHub

1. In Vercel, go to **https://vercel.com/dashboard** -> **New Project**.
2. Import the client's GitHub repository.
3. In **Settings -> Git**, ensure the **Production Branch** is set to `main` (or the active branch `gst-settings`).

---

### 5.3 - Add Environment Variables in Vercel (CRITICAL STEP)

1. In Vercel Project Dashboard, click **Settings** -> **Environment Variables**.
2. Click **Add Environment Variable**:

> [!IMPORTANT]
> At the top of the Add Variable modal, select **`Config`** (NOT `Secret`).
> Vite requires client-side variables prefixed with `VITE_` to be configured as **Config** variables.

Add these 2 variables:

| Variable Type | Key | Value | Environments |
|---|---|---|---|
| **Config** | `VITE_SUPABASE_URL` | `https://<CLIENT-PROJECT-REF>.supabase.co` | Production, Preview |
| **Config** | `VITE_SUPABASE_ANON_KEY` | `<CLIENT-ANON-KEY>` | Production, Preview |

3. Click **Save**.
4. Go to **Deployments** -> Click `...` -> Click **Redeploy** (leave "Use existing Build Cache" unchecked).

---

### 5.4 - Update ALLOWED_ORIGINS in Supabase

Go back to **Supabase -> Project Settings -> Edge Functions -> Manage Secrets**

Update `ALLOWED_ORIGINS`:
```
https://<client-subdomain>.vercel.app,http://localhost:5173
```

---

## PHASE 6 - SUPABASE AUTH CONFIGURATION

### 6.1 - Set Site URL

Go to **Supabase -> Authentication -> URL Configuration**

- **Site URL**: `https://<client-domain>.vercel.app`
- **Redirect URLs**: `https://<client-domain>.vercel.app/**`

Click **Save**.

### 6.2 - Configure Auth Providers (Optional)

Go to **Authentication -> Providers**
- Turn off "Confirm email" toggle if you want users to log in without email verification (simpler for clients).

---

## PHASE 7 - FIRST ADMIN USER SETUP

### 7.1 - Client Signs Up on the Live Site

Have the client go to `https://<client-domain>.vercel.app` and sign up with their admin email.

### 7.2 - Grant Admin Role

Go to **Supabase -> SQL Editor** and run:

```sql
UPDATE public.profiles
SET role = 'admin'
WHERE email = 'admin@clientstore.com';
```

### 7.3 - Update Store Settings

```sql
UPDATE public.settings
SET data = '{
  "storeName": "ABC Sweets",
  "currency": "INR",
  "deliveryFee": 50,
  "freeDeliveryAbove": 500
}'
WHERE id = 'store';
```

---

## PHASE 8 - POST-DEPLOYMENT TESTING CHECKLIST

Test every flow before handing over to the client:

```
[ ] Open live URL - page loads without errors
[ ] Sign up with a new test email - account created
[ ] Log in with the same email - works
[ ] Admin logs in -> can see admin dashboard
[ ] Admin adds a product with variants -> product and variant images appear
[ ] Customer adds variant to cart -> cart calculates correct variant price and image
[ ] Customer places Razorpay order -> payment popup opens with rzp_live key
[ ] Customer completes payment -> order appears in "My Orders" with correct variant image
[ ] Customer places COD order -> order appears with COD status and correct pricing
[ ] Download invoice -> PDF generates correctly with variant line items
[ ] Admin changes order status -> reflects in customer's orders page and admin drawer
[ ] Promo code works -> discount applied accurately
```

> [!CAUTION]
> Make one REAL test payment of Rs. 1 using your own card to verify the entire payment
> flow works in production before handing over to the client.

---

## PHASE 5B - CUSTOM DOMAIN SETUP (Optional)

> Use this when the client owns a domain (e.g. `abcsweets.com`).

### Step 1: Add Domain in Vercel
1. Go to **Vercel -> Project -> Settings -> Domains**.
2. Type the domain: `abcsweets.com` -> Click **Add**.
3. Note down the DNS records provided by Vercel:
   - `A` Record: `@` -> `76.76.21.21`
   - `CNAME` Record: `www` -> `cname.vercel-dns.com`

### Step 2: Add DNS Records at Registrar
Add the A record and CNAME at GoDaddy, Namecheap, Hostinger, etc.

### Step 3: Update Supabase Auth & Secrets
- **Supabase Auth URL Configuration**: Update Site URL to `https://abcsweets.com` and Redirect URLs to `https://abcsweets.com/**`.
- **Edge Functions ALLOWED_ORIGINS Secret**: `https://abcsweets.com,https://www.abcsweets.com,http://localhost:5173`.

---

## PHASE 9 - MASTER SUPABASE - AGGREGATE ALL CLIENT DATA

> [!IMPORTANT]
> **Step 9.1 to 9.3 (Create Tables + Deploy Edge Function)** = ONE TIME ONLY in your master Supabase.
> **Step 9.2 (Register client) + Step 9.4 (6 Webhooks)** = ONCE PER NEW CLIENT.

### Step 9.1 - Create Master Tables (Run ONCE in YOUR Master Supabase)

```sql
-- 1. Client registry
CREATE TABLE public.clients (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  slug           text UNIQUE NOT NULL,
  supabase_url   text,
  webhook_secret text NOT NULL,
  is_active      boolean DEFAULT true,
  created_at     timestamptz DEFAULT now()
);

-- 2. Mirror: Profiles
CREATE TABLE public.m_profiles (
  master_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id),
  client_user_id text NOT NULL,
  name           text,
  email          text,
  phone          text,
  role           text,
  status         text,
  created_at     timestamptz,
  synced_at      timestamptz DEFAULT now(),
  UNIQUE(client_id, client_user_id)
);

-- 3. Mirror: Products
CREATE TABLE public.m_products (
  master_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES public.clients(id),
  client_product_id text NOT NULL,
  title             text,
  category          text,
  price             numeric(12,2),
  stock             integer,
  is_active         boolean,
  created_at        timestamptz,
  synced_at         timestamptz DEFAULT now(),
  UNIQUE(client_id, client_product_id)
);

-- 4. Mirror: Orders
CREATE TABLE public.m_orders (
  master_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id        uuid NOT NULL REFERENCES public.clients(id),
  client_order_id  text NOT NULL,
  client_user_id   text,
  order_status     text,
  payment_method   text,
  payment_status   text,
  subtotal         numeric(12,2),
  discount         numeric(12,2),
  total            numeric(12,2),
  promo_code       text,
  created_at       timestamptz,
  synced_at        timestamptz DEFAULT now(),
  UNIQUE(client_id, client_order_id)
);

-- 5. Mirror: Order Items
CREATE TABLE public.m_order_items (
  master_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES public.clients(id),
  client_item_id    text NOT NULL,
  client_order_id   text,
  client_product_id text,
  title             text,
  price             numeric(12,2),
  quantity          integer,
  synced_at         timestamptz DEFAULT now(),
  UNIQUE(client_id, client_item_id)
);

-- 6. Mirror: Reviews
CREATE TABLE public.m_reviews (
  master_id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id         uuid NOT NULL REFERENCES public.clients(id),
  client_review_id  text NOT NULL,
  client_user_id    text,
  client_product_id text,
  client_order_id   text,
  rating            integer,
  comment           text,
  created_at        timestamptz,
  synced_at         timestamptz DEFAULT now(),
  UNIQUE(client_id, client_review_id)
);

-- 7. Mirror: Promo Codes
CREATE TABLE public.m_promo_codes (
  master_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       uuid NOT NULL REFERENCES public.clients(id),
  client_promo_id text NOT NULL,
  code            text,
  discount_type   text,
  discount_value  numeric(12,2),
  is_active       boolean,
  used_count      integer,
  expiry_date     timestamptz,
  synced_at       timestamptz DEFAULT now(),
  UNIQUE(client_id, client_promo_id)
);

CREATE INDEX idx_m_orders_client   ON public.m_orders(client_id);
CREATE INDEX idx_m_orders_created  ON public.m_orders(created_at);
CREATE INDEX idx_m_profiles_client ON public.m_profiles(client_id);
CREATE INDEX idx_m_products_client ON public.m_products(client_id);
CREATE INDEX idx_m_reviews_client  ON public.m_reviews(client_id);
```

### Step 9.2 - Register Client in Master DB

```sql
INSERT INTO public.clients (name, slug, supabase_url, webhook_secret)
VALUES (
  'ABC Sweets',
  'abc-sweets',
  'https://<abc-project-ref>.supabase.co',
  'my-secret-abc-123'
);
```

### Step 9.3 - Create Webhooks in Client Supabase

In **Client's Supabase -> Database -> Webhooks -> Create Webhook**:

| Webhook Name | Table | Events | URL | Header |
|---|---|---|---|---|
| `sync-profiles` | `profiles` | INSERT, UPDATE | `https://<YOUR-MASTER>.supabase.co/functions/v1/sync-client-data?client=abc-sweets&table=profiles` | `x-webhook-secret: my-secret-abc-123` |
| `sync-products` | `products` | INSERT, UPDATE | `...?client=abc-sweets&table=products` | `x-webhook-secret: my-secret-abc-123` |
| `sync-orders` | `orders` | INSERT, UPDATE | `...?client=abc-sweets&table=orders` | `x-webhook-secret: my-secret-abc-123` |
| `sync-order-items` | `order_items` | INSERT | `...?client=abc-sweets&table=order_items` | `x-webhook-secret: my-secret-abc-123` |
| `sync-reviews` | `reviews` | INSERT, UPDATE | `...?client=abc-sweets&table=reviews` | `x-webhook-secret: my-secret-abc-123` |
| `sync-promos` | `promo_codes` | INSERT, UPDATE | `...?client=abc-sweets&table=promo_codes` | `x-webhook-secret: my-secret-abc-123` |

---

## MASTER CHECKLIST FOR EACH CLIENT

```
[ ] Collect Store Name, Admin Email, Domain, Razorpay status
[ ] Update CartPage.jsx store name
[ ] Create client Supabase project (Mumbai region)
[ ] Run all SQL tables, RLS policies, and RPC functions in SQL editor
[ ] Deploy 9 Edge Functions & set Razorpay + ALLOWED_ORIGINS secrets
[ ] Deploy frontend to Vercel
[ ] Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Vercel as "Config" variables
[ ] Configure Supabase Auth Site URL & Redirect URLs
[ ] Grant admin role to client's email
[ ] Complete real test payment of Rs. 1
[ ] Register client in Master Supabase & setup 6 sync webhooks
[ ] Hand over live website & admin dashboard to client
```

---
*Document Version 2.0 - E-Commerce Platform Production Deployment Guide*
