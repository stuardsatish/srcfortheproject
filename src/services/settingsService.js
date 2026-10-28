import { supabase } from "../context/SupabaseConfig";

/**
 * Reads a settings row's jsonb `data` column by id, or null if not found.
 */
const getSettingsData = async (id) => {
    const { data, error } = await supabase
        .from("settings")
        .select("data")
        .eq("id", id)
        .maybeSingle();
    if (error) throw error;
    return data?.data || null;
};

/**
 * Upserts a settings row, merging `patch` onto whatever data is already
 * stored (read-modify-write) so partial updates don't drop existing keys.
 */
const upsertSettingsData = async (id, patch) => {
    const existing = await getSettingsData(id);
    const merged = { ...(existing || {}), ...patch };
    const { error } = await supabase
        .from("settings")
        .upsert({ id, data: merged, updated_at: new Date().toISOString() });
    if (error) throw error;
};

/**
 * Reads payment gateway configurations from the settings row id='paymentSettings'.
 * Returns defaults if the row does not exist.
 */
export const getPaymentSettings = async () => {
    const data = await getSettingsData("paymentSettings");
    if (data) return data;
    return {
        whatsappPayment: true,
        razorpayPayment: true,
        codPayment: true,
    };
};

/**
 * Saves payment settings to the settings row id='paymentSettings'.
 */
export const savePaymentSettings = async (settings) => {
    await upsertSettingsData("paymentSettings", {
        whatsappPayment: !!settings.whatsappPayment,
        razorpayPayment: !!settings.razorpayPayment,
        codPayment: !!settings.codPayment,
    });
};

/**
 * Reads invoice customization details from the settings row id='invoiceSettings'.
 * Returns empty/default values if the row does not exist.
 */
export const getInvoiceSettings = async () => {
    const data = await getSettingsData("invoiceSettings");
    if (data) return data;
    return {
        companyName: "Nexus Commerce Pvt. Ltd.",
        address: "12 Industrial Layout, Whitefield, Bengaluru, Karnataka 560066",
        mobile: "+91 80 4000 1234",
        email: "support@nexuscommerce.in",
        gstin: "29ABCDE1234F1Z5",
        state: "",
        website: "https://nexuscommerce.in",
        footerTitle: "Thank You!",
        footerSubNote: "We appreciate your business. Visit Again.",
        supportEmail: "support@nexuscommerce.in",
        supportPhone: "+91 80 4000 1234",
        upiId: "",
        logo: "",
    };
};

/**
 * Saves invoice customization details to the settings row id='invoiceSettings'.
 */
export const saveInvoiceSettings = async (settings) => {
    await upsertSettingsData("invoiceSettings", {
        companyName: (settings.companyName || "").trim(),
        address: (settings.address || "").trim(),
        mobile: (settings.mobile || "").trim(),
        email: (settings.email || "").trim(),
        gstin: (settings.gstin || "").trim(),
        state: (settings.state || "").trim(),
        website: (settings.website || "").trim(),
        footerTitle: (settings.footerTitle || "Thank You!").trim(),
        footerSubNote: (settings.footerSubNote || "").trim(),
        supportEmail: (settings.supportEmail || "").trim(),
        supportPhone: (settings.supportPhone || "").trim(),
        upiId: (settings.upiId || "").trim(),
        logo: (settings.logo || "").trim(),
    });
};

/**
 * Reads shipping estimate settings from the settings row id='shippingSettings'.
 * Returns defaults (threshold: 500, cost: 49) if the row does not exist.
 */
export const getShippingSettings = async () => {
    const data = await getSettingsData("shippingSettings");
    if (data) return data;
    return {
        freeShippingThreshold: 500,
        shippingCost: 49,
    };
};

/**
 * Saves shipping estimate settings to the settings row id='shippingSettings'.
 */
export const saveShippingSettings = async (settings) => {
    await upsertSettingsData("shippingSettings", {
        freeShippingThreshold: Number(settings.freeShippingThreshold) || 500,
        shippingCost: Number(settings.shippingCost) || 49,
    });
};

/**
 * Store-wide return / exchange DEFAULTS (settings row id='returnPolicyDefaults', seeded 7 / 7 by migration 20261014_01).
 * They only PRE-FILL new products and bulk imports and feed the static policy pages; the policy of each product lives on the
 * product, and an order keeps the policy it was bought with. Returns the stored document, or null when the row is missing.
 */
export const getReturnPolicyDefaults = async () => getSettingsData("returnPolicyDefaults");

/**
 * Saves the defaults document built by productForm.policyToSettings(). The database re-validates it
 * (migration 20261017_01: windows 1..365 while enabled, none while disabled) and answers errcode 22023 otherwise.
 */
export const saveReturnPolicyDefaults = async (doc) => {
    await upsertSettingsData("returnPolicyDefaults", doc);
};

/**
 * Reads GST settings from the settings row id='gstSettings'.
 * Defaults to { gstEnabled: true } so existing behaviour is preserved
 * for stores that have never touched this setting.
 */
export const getGstSettings = async () => {
    const data = await getSettingsData("gstSettings");
    if (data) return { gstEnabled: data.gstEnabled !== false }; // default true
    return { gstEnabled: true };
};

/**
 * Saves GST settings to the settings row id='gstSettings'.
 */
export const saveGstSettings = async (settings) => {
    await upsertSettingsData("gstSettings", {
        gstEnabled: settings.gstEnabled !== false,
    });
};