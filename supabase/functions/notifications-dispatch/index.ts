// Roadmap 7.3 — push delivery. Drains the `notifications` outbox to Expo's push
// service.
//
// The database triggers (migration 20261008_04_notifications.sql) write one row
// per event; this function claims pending rows (claim_pending_notifications —
// atomic, so overlapping runs never double-send), looks up each recipient's
// device tokens, posts them to Expo, and records the outcome.
//
// HOW IT IS TRIGGERED (pick one, both are safe together because claiming is atomic):
//   * Dashboard -> Database -> Webhooks -> Create: table `notifications`,
//     event INSERT, type "HTTP Request" (POST) to this function's URL, with the
//     HTTP header  x-dispatch-secret: <your DISPATCH_SECRET>.
//     The body is ignored; the call is just "wake up and drain the queue".
//   * A schedule (pg_cron + pg_net, or any external cron) POSTing the same header
//     every minute — this also retries anything left behind.
//
// SECRETS (supabase secrets set ...):
//   DISPATCH_SECRET     required. Shared secret for the x-dispatch-secret header.
//   EXPO_ACCESS_TOKEN   optional. Only needed if "Enhanced Push Security" is on
//                       for your Expo project.
// Deploy with "Verify JWT" OFF (like payment-webhook): the database calls this
// directly with the shared secret, not a user session.
import { handlePreflight, jsonResponse, methodNotAllowed } from "../_shared/cors.ts";
import { supabaseAdmin } from "../_shared/clients.ts";

const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";
const BATCH = 100; // Expo accepts at most 100 messages per request
const MAX_ATTEMPTS = 5; // keep in step with claim_pending_notifications()

type Notification = {
    id: string;
    user_id: string;
    kind: string;
    title: string;
    body: string;
    data: Record<string, unknown> | null;
    push_attempts: number;
};
type Ticket = { status: "ok" | "error"; id?: string; message?: string; details?: { error?: string } };

/** Constant-time string comparison. */
function safeEqual(a: string, b: string): boolean {
    const x = new TextEncoder().encode(a);
    const y = new TextEncoder().encode(b);
    if (x.length !== y.length) return false;
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
    return diff === 0;
}

function isAuthorised(req: Request): boolean {
    const secret = Deno.env.get("DISPATCH_SECRET") || "";
    const sent = req.headers.get("x-dispatch-secret") || "";
    if (secret && safeEqual(sent, secret)) return true;
    // Also accept the service-role key as a bearer, for manual/cron invocations.
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
    const bearer = req.headers.get("Authorization") || "";
    return !!serviceKey && safeEqual(bearer, `Bearer ${serviceKey}`);
}

const isExpoToken = (t: string) => /^Expo(nent)?PushToken\[.+\]$/.test(t);

async function sendToExpo(messages: Record<string, unknown>[]): Promise<Ticket[]> {
    const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
    };
    const accessToken = Deno.env.get("EXPO_ACCESS_TOKEN");
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const res = await fetch(EXPO_PUSH_URL, { method: "POST", headers, body: JSON.stringify(messages) });
    if (!res.ok) throw new Error(`Expo push responded ${res.status}`);
    const json = await res.json();
    const tickets = json?.data;
    if (!Array.isArray(tickets) || tickets.length !== messages.length) {
        throw new Error("Unexpected Expo push response shape");
    }
    return tickets as Ticket[];
}

Deno.serve(async (req) => {
    const preflight = handlePreflight(req);
    if (preflight) return preflight;
    const methodErr = methodNotAllowed(req, ["POST"]);
    if (methodErr) return methodErr;

    if (!Deno.env.get("DISPATCH_SECRET")) {
        console.error("[notifications-dispatch] DISPATCH_SECRET is not configured");
        return jsonResponse(req, 500, { success: false, error: "Dispatcher is not configured" });
    }
    if (!isAuthorised(req)) {
        return jsonResponse(req, 401, { success: false, error: "Unauthorised" });
    }

    const admin = supabaseAdmin();
    const summary = { claimed: 0, sent: 0, skipped: 0, retry: 0, failed: 0, tokensDisabled: 0 };

    try {
        const { data: claimedRows, error: claimErr } = await admin.rpc("claim_pending_notifications", { p_limit: 100 });
        if (claimErr) throw claimErr;
        const claimed = (claimedRows || []) as Notification[];
        summary.claimed = claimed.length;
        if (!claimed.length) return jsonResponse(req, 200, { success: true, ...summary });

        // recipients' enabled device tokens
        const userIds = [...new Set(claimed.map((n) => n.user_id))];
        const { data: tokenRows, error: tokenErr } = await admin
            .from("device_tokens")
            .select("user_id, token")
            .in("user_id", userIds)
            .eq("enabled", true);
        if (tokenErr) throw tokenErr;
        const tokensByUser = new Map<string, string[]>();
        for (const r of tokenRows || []) {
            if (!isExpoToken(r.token)) continue; // anything else cannot be pushed through Expo
            const list = tokensByUser.get(r.user_id) || [];
            list.push(r.token);
            tokensByUser.set(r.user_id, list);
        }

        // one Expo message per (notification, device)
        const queue: { notificationId: string; token: string; message: Record<string, unknown> }[] = [];
        for (const n of claimed) {
            for (const token of tokensByUser.get(n.user_id) || []) {
                queue.push({
                    notificationId: n.id,
                    token,
                    message: {
                        to: token,
                        title: n.title,
                        body: n.body,
                        data: { ...(n.data || {}), notificationId: n.id, kind: n.kind },
                        sound: "default",
                        channelId: "default",
                        priority: "high",
                    },
                });
            }
        }

        // notificationId -> { ok, deadTokens, transientError }
        const outcome = new Map<string, { ok: number; permanent: number; transient: number }>();
        const bump = (id: string, key: "ok" | "permanent" | "transient") => {
            const o = outcome.get(id) || { ok: 0, permanent: 0, transient: 0 };
            o[key]++;
            outcome.set(id, o);
        };
        const deadTokens = new Set<string>();

        for (let i = 0; i < queue.length; i += BATCH) {
            const chunk = queue.slice(i, i + BATCH);
            let tickets: Ticket[];
            try {
                tickets = await sendToExpo(chunk.map((q) => q.message));
            } catch (e) {
                console.error("[notifications-dispatch] Expo request failed:", e);
                for (const q of chunk) bump(q.notificationId, "transient");
                continue;
            }
            tickets.forEach((t, idx) => {
                const q = chunk[idx];
                if (t.status === "ok") return bump(q.notificationId, "ok");
                if (t.details?.error === "DeviceNotRegistered") {
                    deadTokens.add(q.token);
                    return bump(q.notificationId, "permanent");
                }
                // MessageTooBig / InvalidCredentials / MessageRateExceeded ...: retry later
                console.warn("[notifications-dispatch] ticket error:", t.details?.error || t.message);
                bump(q.notificationId, "transient");
            });
        }

        if (deadTokens.size) {
            await admin.from("device_tokens").update({ enabled: false }).in("token", [...deadTokens]);
            summary.tokensDisabled = deadTokens.size;
        }

        // record the result for every claimed notification
        const now = new Date().toISOString();
        for (const n of claimed) {
            const o = outcome.get(n.id);
            let status: "sent" | "skipped" | "pending" | "failed";
            if (!o) status = "skipped"; // recipient has no usable device
            else if (o.ok > 0) status = "sent";
            else if (o.transient > 0) status = n.push_attempts >= MAX_ATTEMPTS ? "failed" : "pending";
            else status = "skipped"; // every device was unregistered
            if (status === "sent") summary.sent++;
            else if (status === "skipped") summary.skipped++;
            else if (status === "pending") summary.retry++;
            else summary.failed++;
            await admin
                .from("notifications")
                .update({ push_status: status, pushed_at: status === "sent" ? now : null })
                .eq("id", n.id);
        }

        return jsonResponse(req, 200, { success: true, ...summary });
    } catch (err) {
        console.error("[notifications-dispatch] failed:", err);
        return jsonResponse(req, 500, { success: false, error: "Dispatch failed", ...summary });
    }
});