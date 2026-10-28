// Order add-ons that are not part of the money path: the gift option
// (roadmap 5.10/5.11) and the extra rules for guest checkout (roadmap 8.1).
//
// Kept apart from pricing.ts on purpose: nothing in here may change an
// order's price, tax or stock, so it is easy to review as "cannot affect money".
import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

// -- gift ---------------------------------------------------------------------

export type GiftOptions = { wrap: boolean; message: string };

/**
 * Normalises the client's `gift` object. Returns null when there is nothing to
 * store, and NEVER throws — a malformed gift field must not stop an order.
 * Control characters are stripped and the message capped at 300 chars (the same
 * limit the `orders_gift_message_len` constraint enforces).
 */
export function sanitizeGift(raw: unknown): GiftOptions | null {
    if (!raw || typeof raw !== "object") return null;
    const r = raw as Record<string, unknown>;
    const wrap = r.wrap === true;
    const message = String(r.message ?? "")
        // deno-lint-ignore no-control-regex
        .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
        .trim()
        .slice(0, 300);
    if (!wrap && !message) return null;
    return { wrap, message };
}

/**
 * Writes the gift options onto an order that already exists. Best effort: by
 * the time this runs the order is created (and, for Razorpay, already paid), so
 * a failure here — e.g. the 2026-10-08 migration not applied yet — is logged and
 * swallowed rather than failing the checkout.
 */
export async function saveGiftOptions(admin: SupabaseClient, orderId: string, gift: GiftOptions | null | undefined) {
    if (!gift) return;
    try {
        const { error } = await admin
            .from("orders")
            .update({ gift_wrap: gift.wrap, gift_message: gift.message || null })
            .eq("id", orderId);
        if (error) console.warn("[gift] could not save gift options:", error.message);
    } catch (e) {
        console.warn("[gift] could not save gift options:", e);
    }
}

// -- guest checkout -----------------------------------------------------------
// A guest is a Supabase *anonymous* session (auth.users.is_anonymous = true).
// It is a real user row, so every existing RLS policy, rate limiter and order
// path works unchanged; the only differences are the rules below.

export function isGuestUser(user: { is_anonymous?: boolean } | null | undefined): boolean {
    return user?.is_anonymous === true;
}

export type ContactProfile = {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
    address?: unknown;
};

/**
 * A guest has no verified email, so the delivery details are the only link
 * between the order and the person. Returns a user-readable message, or null
 * when the profile is complete enough to ship to.
 */
export function validateGuestContact(p: ContactProfile | null | undefined): string | null {
    if (!p) return "Please enter your contact and delivery details.";
    if (String(p.name || "").trim().length < 2) return "Please enter your name.";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(p.email || "").trim())) return "Please enter a valid email address.";
    const digits = String(p.phone || "").replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 15) return "Please enter a valid phone number.";
    const a = (p.address && typeof p.address === "object" ? p.address : {}) as Record<string, unknown>;
    if (String(a.street || "").trim().length < 3) return "Please enter your street address.";
    if (!String(a.city || "").trim()) return "Please enter your city.";
    if (!String(a.state || "").trim()) return "Please enter your state.";
    if (!/^\d{6}$/.test(String(a.pincode || "").trim())) return "Please enter a valid 6-digit pincode.";
    return null;
}

/**
 * Cash on Delivery is the easiest way to place a fake order, and a guest costs
 * nothing to create. So it is OFF for guests unless the store explicitly turns
 * it on: settings row `paymentSettings` -> data.guestCod = true.
 */
export async function isGuestCodAllowed(admin: SupabaseClient): Promise<boolean> {
    try {
        const { data, error } = await admin.from("settings").select("data").eq("id", "paymentSettings").maybeSingle();
        if (error || !data?.data) return false;
        return data.data.guestCod === true;
    } catch (e) {
        console.warn("[guest] payment settings lookup failed:", e);
        return false;
    }
}

/** Best-effort caller IP (the platform sets x-forwarded-for). "unknown" when absent. */
export function clientIp(req: Request): string {
    const fwd = req.headers.get("x-forwarded-for") || "";
    const first = fwd.split(",")[0]?.trim();
    return first || req.headers.get("cf-connecting-ip") || req.headers.get("x-real-ip") || "unknown";
}