import React, { useState, useEffect } from "react"
import { useSettings } from "../../hooks/useSettings"
import { supabase } from "../../context/SupabaseConfig"
import { toast } from "react-toastify"
import ReturnPolicyDefaultsCard from "../../features/products/admin/ReturnPolicyDefaultsCard"
import CouriersCard from "../../features/orders/shipping/CouriersCard"
import RequestReasonsCard from "../../features/returns/admin/RequestReasonsCard"
import {
  CreditCard, Receipt, Loader2, Building, MapPin, Phone, Mail,
  FileText, Globe, Info, Image as ImageIcon, Truck,
  ShieldCheck, Banknote, Moon, Bell, ChevronDown, ChevronUp
} from "lucide-react"

/* ── Pelago Typography ────────────────────────────────────────────── */
const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
const DISPLAY = "'Space Grotesk', 'Plus Jakarta Sans', sans-serif"

const toDateSafe = (v) => {
  if (!v) return null
  if (v?.toDate) return v.toDate()
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

const isToday = (d) => {
  if (!d) return false
  const n = new Date()
  return (
    d.getFullYear() === n.getFullYear() &&
    d.getMonth() === n.getMonth() &&
    d.getDate() === n.getDate()
  )
}

const Optimization = () => {
  const {
    paymentSettings,
    invoiceSettings,
    shippingSettings,
    gstSettings,
    loading,
    savingPayment,
    savingInvoice,
    savingShipping,
    savingGst,
    updatePaymentSettings,
    updateInvoiceSettings,
    updateShippingSettings,
    updateGstSettings,
  } = useSettings()

  // Local Form States
  const [whatsappPayment, setWhatsappPayment] = useState(true)
  const [razorpayPayment, setRazorpayPayment] = useState(true)
  const [codPayment, setCodPayment] = useState(true)

  // Shipping state
  const [freeShippingThreshold, setFreeShippingThreshold] = useState(500)
  const [shippingCost, setShippingCost] = useState(49)

  // GST state
  const [gstEnabled, setGstEnabled] = useState(true)

  // Invoice state
  const [companyName, setCompanyName] = useState("")
  const [address, setAddress] = useState("")
  const [mobile, setMobile] = useState("")
  const [email, setEmail] = useState("")
  const [gstin, setGstin] = useState("")
  const [sellerState, setSellerState] = useState("")
  const [website, setWebsite] = useState("")
  const [footerTitle, setFooterTitle] = useState("Thank You!")
  const [footerSubNote, setFooterSubNote] = useState("")
  const [supportEmail, setSupportEmail] = useState("")
  const [supportPhone, setSupportPhone] = useState("")
  const [upiId, setUpiId] = useState("")
  const [logo, setLogo] = useState("")

  // Live today stats
  const [today, setToday] = useState({ count: 0, revenue: 0 })
  const [showAdvancedPolicies, setShowAdvancedPolicies] = useState(false)

  // Sync state with hook data when loaded
  useEffect(() => {
    if (!loading) {
      setWhatsappPayment(paymentSettings.whatsappPayment !== false)
      setRazorpayPayment(paymentSettings.razorpayPayment !== false)
      setCodPayment(paymentSettings.codPayment !== false)

      setFreeShippingThreshold(Number(shippingSettings.freeShippingThreshold ?? 500))
      setShippingCost(Number(shippingSettings.shippingCost ?? 49))

      setGstEnabled(gstSettings.gstEnabled !== false)

      setCompanyName(invoiceSettings.companyName || "")
      setAddress(invoiceSettings.address || "")
      setMobile(invoiceSettings.mobile || "")
      setEmail(invoiceSettings.email || "")
      setGstin(invoiceSettings.gstin || "")
      setSellerState(invoiceSettings.state || "")
      setWebsite(invoiceSettings.website || "")
      setFooterTitle(invoiceSettings.footerTitle || "Thank You!")
      setFooterSubNote(invoiceSettings.footerSubNote || "")
      setSupportEmail(invoiceSettings.supportEmail || "")
      setSupportPhone(invoiceSettings.supportPhone || "")
      setUpiId(invoiceSettings.upiId || "")
      setLogo(invoiceSettings.logo || "")
    }
  }, [loading, paymentSettings, invoiceSettings, shippingSettings, gstSettings])

  // Load live today orders stats
  useEffect(() => {
    let active = true
    ;(async () => {
      try {
        const { data: rows } = await supabase
          .from("orders")
          .select("id, total, created_at")
          .order("created_at", { ascending: false })
          .limit(200)
        if (rows && active) {
          const todays = rows.filter((o) => isToday(toDateSafe(o.created_at)))
          setToday({
            count: todays.length,
            revenue: todays.reduce((s, o) => s + Number(o.total || 0), 0),
          })
        }
      } catch (e) {
        console.warn("Failed to load today stats:", e)
      }
    })()
    return () => { active = false }
  }, [])

  const handleSavePayment = async (e) => {
    e.preventDefault()
    await updatePaymentSettings({
      whatsappPayment,
      razorpayPayment,
      codPayment,
    })
    toast.success("Payment settings saved successfully!")
  }

  const handleSaveShipping = async (e) => {
    e.preventDefault()
    const threshold = Number(freeShippingThreshold)
    const cost = Number(shippingCost)
    if (isNaN(threshold) || threshold < 0) {
      toast.error("Please enter a valid free shipping threshold (0 or more).")
      return
    }
    if (isNaN(cost) || cost < 0) {
      toast.error("Please enter a valid shipping cost (0 or more).")
      return
    }
    await updateShippingSettings({ freeShippingThreshold: threshold, shippingCost: cost })
    toast.success("Shipping settings saved successfully!")
  }

  const handleSaveGst = async (e) => {
    e.preventDefault()
    await updateGstSettings({ gstEnabled })
    toast.success("GST settings saved successfully!")
  }

  const handleSaveInvoice = async (e) => {
    e.preventDefault()
    await updateInvoiceSettings({
      companyName,
      address,
      mobile,
      email,
      gstin,
      state: sellerState,
      website,
      footerTitle,
      footerSubNote,
      supportEmail,
      supportPhone,
      upiId,
      logo,
    })
    toast.success("Invoice settings saved successfully!")
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3" style={{ fontFamily: FONT }}>
        <Loader2 className="h-9 w-9 animate-spin text-[#104945]" />
        <p className="font-medium text-xs text-[#5D6B65]">Loading optimization module...</p>
      </div>
    )
  }

  return (
    <main
      style={{ fontFamily: FONT }}
      className="flex-1 w-full space-y-5 text-[#162320] pb-16 pr-6 sm:pr-8 md:pr-10 lg:pr-12 max-w-[1240px]"
      data-purpose="main-content"
    >
      {/* ── Top Title and Live Stats Bar ── */}
      <header className="flex flex-col md:flex-row md:items-center justify-between gap-4 pt-1 pb-1">
        <div>
          <h2
            style={{ fontFamily: DISPLAY }}
            className="text-2xl font-bold text-[#14211D] tracking-tight"
          >
            Optimization Module
          </h2>
          <p className="text-xs text-[#5D6B65] mt-0.5">
            Toggle customer payment methods and customize downloadable invoice PDF structures.
          </p>
        </div>

        {/* Right Quick Actions / Stats */}
        <div className="flex items-center gap-2.5 shrink-0">
          {/* Active Sales Pill */}
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#FFFFFF] rounded-full border border-[#DFD9CD] shadow-sm text-xs font-medium text-[#384641]">
            <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block animate-pulse"></span>
            <span>{today.count} today</span>
            <span className="text-[#8B9691] font-normal">
              {today.revenue >= 1000 ? `₹${(today.revenue / 1000).toFixed(1)}k` : `₹${today.revenue}`}
            </span>
          </div>

          {/* Dark Mode Toggle Button */}
          <button
            onClick={() => toast.info("Dark mode toggled.")}
            className="w-8 h-8 rounded-full bg-white border border-[#DFD9CD] flex items-center justify-center text-[#5D6B65] hover:text-black shadow-sm transition-colors cursor-pointer"
            type="button"
            title="Toggle theme"
          >
            <Moon className="w-4 h-4" />
          </button>

          {/* Notification Bell Button */}
          <button
            onClick={() => toast.info("No unread notifications.")}
            className="relative w-8 h-8 rounded-full bg-white border border-[#DFD9CD] flex items-center justify-center text-[#5D6B65] hover:text-black shadow-sm transition-colors cursor-pointer"
            type="button"
            title="Notifications"
          >
            <Bell className="w-4 h-4" />
            <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-red-500 rounded-full"></span>
          </button>
        </div>
      </header>

      {/* ── BEGIN: Card1 - Payment Settings ── */}
      <section
        className="bg-white rounded-3xl p-6 md:p-7 border border-[#E2DBD0] shadow-sm"
        data-purpose="payment-settings-card"
      >
        <form onSubmit={handleSavePayment}>
          {/* Header */}
          <div className="flex items-start gap-3.5 mb-5">
            <div className="w-9 h-9 rounded-xl bg-[#EAF2ED] text-[#104945] flex items-center justify-center shrink-0">
              <CreditCard className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#14211D]">Payment Settings</h3>
              <p className="text-xs text-[#6A7771] mt-0.5">
                Configure which checkout methods are active for users. If all are disabled, checkout will be locked.
              </p>
            </div>
          </div>

          {/* Section Label */}
          <h4 className="text-[10px] font-bold uppercase tracking-wider text-[#8F9A95] mb-3">
            Available Payment Methods
          </h4>

          {/* Methods Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-3">
            {/* Method 1: WhatsApp Payment */}
            <div
              onClick={() => setWhatsappPayment(!whatsappPayment)}
              className="flex items-start gap-3 p-3.5 rounded-xl border border-[#DFE7E2] bg-[#FAFCFB] hover:border-[#104945] cursor-pointer transition-all select-none"
            >
              <div className="pt-0.5">
                <input
                  checked={whatsappPayment}
                  readOnly
                  className="w-4 h-4 rounded text-[#104945] focus:ring-0 focus:ring-offset-0 border-[#B5C2BC] cursor-pointer"
                  type="checkbox"
                />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#182622]">WhatsApp Payment</span>
                  <span className="text-[10px] bg-[#E3F2E9] text-[#1D744C] px-1.5 py-0.2 rounded font-medium">
                    Direct Chat
                  </span>
                </div>
                <p className="text-[11px] text-[#717E79]">Place order and text details via WhatsApp</p>
              </div>
            </div>

            {/* Method 2: Razorpay Payment */}
            <div
              onClick={() => setRazorpayPayment(!razorpayPayment)}
              className="flex items-start gap-3 p-3.5 rounded-xl border border-[#DFE7E2] bg-[#FAFCFB] hover:border-[#104945] cursor-pointer transition-all select-none"
            >
              <div className="pt-0.5">
                <input
                  checked={razorpayPayment}
                  readOnly
                  className="w-4 h-4 rounded text-[#104945] focus:ring-0 focus:ring-offset-0 border-[#B5C2BC] cursor-pointer"
                  type="checkbox"
                />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-[#182622]">Razorpay Payment</span>
                  <span className="text-[10px] bg-[#D8EAE6] text-[#175C54] px-1.5 py-0.2 rounded font-medium">
                    Card/UPI/Netbanking
                  </span>
                </div>
                <p className="text-[11px] text-[#717E79]">Secure online payments via Razorpay card/UPI</p>
              </div>
            </div>
          </div>

          {/* Method 3: Cash on Delivery (COD) */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
            <div
              onClick={() => setCodPayment(!codPayment)}
              className="flex items-start gap-3 p-3.5 rounded-xl border border-[#DFE7E2] bg-[#FAFCFB] hover:border-[#104945] cursor-pointer transition-all select-none"
            >
              <div className="pt-0.5">
                <input
                  checked={codPayment}
                  readOnly
                  className="w-4 h-4 rounded text-[#104945] focus:ring-0 focus:ring-offset-0 border-[#B5C2BC] cursor-pointer"
                  type="checkbox"
                />
              </div>
              <div className="space-y-0.5">
                <div className="flex items-center gap-1.5">
                  <Banknote className="w-3.5 h-3.5 text-[#52605B]" />
                  <span className="text-xs font-bold text-[#182622]">Cash on Delivery (COD)</span>
                </div>
                <p className="text-[11px] text-[#717E79]">Allow customers to pay cash when their order is delivered.</p>
              </div>
            </div>
          </div>

          {/* Action Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingPayment}
              className="inline-flex items-center gap-2 bg-[#1B4332] hover:bg-[#123023] text-white px-4 py-2 rounded-xl text-xs font-medium shadow-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              {savingPayment ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" strokeLinecap="round" strokeLinejoin="round"></path>
                  </svg>
                  <span>Save Payment Settings</span>
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* ── BEGIN: Card2 - Shipping Estimate ── */}
      <section
        className="bg-white rounded-3xl p-6 md:p-7 border border-[#E2DBD0] shadow-sm"
        data-purpose="shipping-estimate-card"
      >
        <form onSubmit={handleSaveShipping}>
          {/* Header */}
          <div className="flex items-start gap-3.5 mb-5">
            <div className="w-9 h-9 rounded-xl bg-[#EAF2ED] text-[#104945] flex items-center justify-center shrink-0">
              <Truck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#14211D]">Shipping Estimate</h3>
              <p className="text-xs text-[#6A7771] mt-0.5">
                Define the minimum order value required for free shipping and the flat shipping fee applied below that threshold. These values are read server-side during payment computation.
              </p>
            </div>
          </div>

          {/* Info Notification Bar */}
          <div className="flex items-center gap-2.5 p-3 rounded-xl bg-[#EAF4F2] border border-[#BDDCD5] mb-5 text-xs text-[#1C4E48]">
            <svg className="w-4 h-4 shrink-0 text-[#144741]" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" strokeLinecap="round" strokeLinejoin="round"></path>
            </svg>
            <span>
              Current rule: Orders above <strong className="font-bold">₹{freeShippingThreshold}</strong> get <strong className="font-bold">free shipping</strong>; orders below pay <strong className="font-bold">₹{shippingCost}</strong> shipping.
            </span>
          </div>

          {/* Input Row */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                Free Shipping Threshold (₹)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-xs text-gray-500 font-medium">₹</span>
                <input
                  className="w-full pl-7 pr-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none"
                  type="number"
                  min="0"
                  step="1"
                  required
                  placeholder="e.g. 500"
                  value={freeShippingThreshold}
                  onChange={(e) => setFreeShippingThreshold(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-[#7A8681] mt-1">Orders at or above this amount qualify for free delivery.</p>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                Shipping Cost (₹)
              </label>
              <div className="relative">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-xs text-gray-500 font-medium">₹</span>
                <input
                  className="w-full pl-7 pr-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none"
                  type="number"
                  min="0"
                  step="1"
                  required
                  placeholder="e.g. 49"
                  value={shippingCost}
                  onChange={(e) => setShippingCost(e.target.value)}
                />
              </div>
              <p className="text-[11px] text-[#7A8681] mt-1">Flat fee charged on orders below the free shipping threshold.</p>
            </div>
          </div>

          {/* Action Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingShipping}
              className="inline-flex items-center gap-2 bg-[#1B4332] hover:bg-[#123023] text-white px-4 py-2 rounded-xl text-xs font-medium shadow-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              {savingShipping ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" strokeLinecap="round" strokeLinejoin="round"></path>
                  </svg>
                  <span>Save Shipping Settings</span>
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* ── BEGIN: Card3 - GST Settings ── */}
      <section
        className="bg-white rounded-3xl p-6 md:p-7 border border-[#E2DBD0] shadow-sm"
        data-purpose="gst-settings-card"
      >
        <form onSubmit={handleSaveGst}>
          {/* Header */}
          <div className="flex items-start gap-3.5 mb-5">
            <div className="w-9 h-9 rounded-xl bg-[#EAF2ED] text-[#104945] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#14211D]">GST Settings</h3>
              <p className="text-xs text-[#6A7771] mt-0.5">
                Control whether GST (Goods & Services Tax) is applied across your store. When disabled, prices are treated as final — no tax breakdown appears anywhere (invoices, cart, order details).
              </p>
            </div>
          </div>

          {/* Status Toggle Banner */}
          <div
            onClick={() => setGstEnabled(!gstEnabled)}
            className={`flex items-center justify-between p-3.5 rounded-2xl mb-5 border transition-all cursor-pointer select-none ${
              gstEnabled
                ? "bg-[#ECFDF5] border-[#A7F3D0]"
                : "bg-[#FBF9F6] border-[#E5DFD4]"
            }`}
          >
            <div className="flex items-center gap-3">
              <div
                className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                  gstEnabled
                    ? "bg-[#D1FAE5] text-[#065F46]"
                    : "bg-gray-100 text-gray-400"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round"></path>
                </svg>
              </div>
              <div>
                <p className={`text-xs font-bold ${gstEnabled ? "text-[#064E3B]" : "text-gray-800"}`}>
                  GST is currently{" "}
                  <span className={gstEnabled ? "text-[#059669]" : "text-gray-500"}>
                    {gstEnabled ? "Enabled" : "Disabled"}
                  </span>
                </p>
                <p className={`text-[11px] ${gstEnabled ? "text-[#047857]" : "text-gray-500"}`}>
                  {gstEnabled
                    ? "Tax is computed per product and shown in invoices, cart and order details."
                    : "GST is ignored. Product price = final price. No tax details anywhere."}
                </p>
              </div>
            </div>

            {/* Active Switch Toggle */}
            <button
              onClick={(e) => {
                e.stopPropagation()
                setGstEnabled(!gstEnabled)
              }}
              aria-label="Toggle GST"
              className={`w-11 h-6 rounded-full p-0.5 flex items-center transition-colors cursor-pointer ${
                gstEnabled ? "bg-[#104945] justify-end" : "bg-gray-300 justify-start"
              }`}
              type="button"
            >
              <span className="w-5 h-5 rounded-full bg-white shadow-md block"></span>
            </button>
          </div>

          {/* Comparison Boxes: GST ON vs OFF */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            {/* Box: When GST is ON */}
            <div
              className={`p-4 rounded-2xl border transition-all ${
                gstEnabled
                  ? "border-[#D1FAE5] bg-[#F7FCF9]"
                  : "border-[#E5DFD4] bg-[#FBF9F6] opacity-70"
              }`}
            >
              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                <h5 className="text-xs font-bold text-[#1B382B]">When GST is ON</h5>
              </div>
              <ul className="text-[11px] text-[#4A5D54] space-y-1.5 list-disc list-inside">
                <li>Tax breakdown in invoices (CGST / SGST / IGST)</li>
                <li>&ldquo;Tax included in price&rdquo; shown in cart</li>
                <li>Taxable value & GST amounts shown in order details</li>
                <li>HSN codes & GST% columns in invoice PDF</li>
              </ul>
            </div>

            {/* Box: When GST is OFF */}
            <div
              className={`p-4 rounded-2xl border transition-all ${
                !gstEnabled
                  ? "border-[#F8B4B4] bg-[#FEE2E2]/30"
                  : "border-[#E5DFD4] bg-[#FBF9F6] opacity-70"
              }`}
            >
              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-2 h-2 rounded-full bg-gray-400"></span>
                <h5 className="text-xs font-bold text-[#3E4A45]">When GST is OFF</h5>
              </div>
              <ul className="text-[11px] text-[#63726B] space-y-1.5 list-disc list-inside">
                <li>Product price = total price, GST fields ignored</li>
                <li>No tax row in cart or order summary</li>
                <li>Invoice PDF shows simple price table only</li>
                <li>No CGST / SGST / IGST stored on new orders</li>
              </ul>
            </div>
          </div>

          {/* Action Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingGst}
              className="inline-flex items-center gap-2 bg-[#1B4332] hover:bg-[#123023] text-white px-4 py-2 rounded-xl text-xs font-medium shadow-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              {savingGst ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" strokeLinecap="round" strokeLinejoin="round"></path>
                  </svg>
                  <span>Save GST Settings</span>
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* ── BEGIN: Card4 - Invoice Settings ── */}
      <section
        className="bg-white rounded-3xl p-6 md:p-7 border border-[#E2DBD0] shadow-sm"
        data-purpose="invoice-settings-card"
      >
        <form onSubmit={handleSaveInvoice}>
          {/* Header */}
          <div className="flex items-start gap-3.5 mb-6">
            <div className="w-9 h-9 rounded-xl bg-[#EAF2ED] text-[#104945] flex items-center justify-center shrink-0">
              <Receipt className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-[#14211D]">Invoice Settings</h3>
              <p className="text-xs text-[#6A7771] mt-0.5">
                Customize values shown inside tax invoices generated dynamically. Empty optional fields will be hidden in the PDF layout.
              </p>
            </div>
          </div>

          {/* Form Fields Grid */}
          <div className="space-y-4 mb-6">
            {/* Row 1: Company Name & Logo URL */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                  <Building className="w-3 h-3 text-[#798580]" />
                  <span>Company Name <span className="text-red-500">*</span></span>
                </label>
                <input
                  required
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="e.g. Nexus Commerce Pvt. Ltd."
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] placeholder-[#9AA5A0] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none"
                  type="text"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                  <ImageIcon className="w-3 h-3 text-[#798580]" />
                  <span>Logo URL (Optional)</span>
                </label>
                <input
                  value={logo}
                  onChange={(e) => setLogo(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] placeholder-[#9AA5A0] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none"
                  placeholder="e.g. https://domain.com/logo.png"
                  type="text"
                />
              </div>
            </div>

            {/* Row 2: Company Address (Full Width) */}
            <div>
              <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                <MapPin className="w-3 h-3 text-[#798580]" />
                <span>Company Address</span>
              </label>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Full physical billing location details"
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] placeholder-[#9AA5A0] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none"
                type="text"
              />
            </div>

            {/* Row 3: Company Mobile & Company Email */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                  <Phone className="w-3 h-3 text-[#798580]" />
                  <span>Company Mobile</span>
                </label>
                <input
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value)}
                  placeholder="e.g. +91 99405 74522"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] placeholder-[#9AA5A0] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none"
                  type="text"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                  <Mail className="w-3 h-3 text-[#798580]" />
                  <span>Company Email</span>
                </label>
                <input
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="e.g. billing@company.com"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] placeholder-[#9AA5A0] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none"
                  type="email"
                />
              </div>
            </div>

            {/* Row 4: GSTIN Number & Seller State */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                  <FileText className="w-3 h-3 text-[#798580]" />
                  <span>GSTIN Number</span>
                </label>
                <input
                  value={gstin}
                  onChange={(e) => setGstin(e.target.value)}
                  placeholder="e.g. 29ABCDE1234F1Z5"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] placeholder-[#9AA5A0] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none uppercase font-semibold"
                  type="text"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                  <MapPin className="w-3 h-3 text-[#798580]" />
                  <span>Seller State</span>
                </label>
                <input
                  value={sellerState}
                  onChange={(e) => setSellerState(e.target.value)}
                  placeholder="e.g. Tamil Nadu"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] placeholder-[#9AA5A0] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none"
                  type="text"
                />
                <p className="text-[10px] text-[#7E8B85] mt-1">
                  Used to split GST: same state as buyer → CGST + SGST, different state → IGST.
                </p>
              </div>
            </div>

            {/* Row 5: Website & Footer Heading */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                  <Globe className="w-3 h-3 text-[#798580]" />
                  <span>Website</span>
                </label>
                <input
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  placeholder="e.g. https://www.company.com"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] placeholder-[#9AA5A0] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none"
                  type="url"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                  <span className="font-serif font-black text-xs text-[#798580]">H</span>
                  <span>Footer Heading</span>
                </label>
                <input
                  value={footerTitle}
                  onChange={(e) => setFooterTitle(e.target.value)}
                  placeholder="Thank You!"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] placeholder-[#9AA5A0] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none"
                  type="text"
                />
              </div>
            </div>

            {/* Row 6: Footer Sub Note (Full Width) */}
            <div>
              <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                <Info className="w-3 h-3 text-[#798580]" />
                <span>Footer Sub Note</span>
              </label>
              <input
                value={footerSubNote}
                onChange={(e) => setFooterSubNote(e.target.value)}
                placeholder="We appreciate your business. Visit Again."
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] placeholder-[#9AA5A0] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none"
                type="text"
              />
            </div>

            {/* Row 7: Support Email & Support Phone */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                  <Mail className="w-3 h-3 text-[#798580]" />
                  <span>Support Email</span>
                </label>
                <input
                  value={supportEmail}
                  onChange={(e) => setSupportEmail(e.target.value)}
                  placeholder="e.g. support@company.com"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] placeholder-[#9AA5A0] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none"
                  type="email"
                />
              </div>
              <div>
                <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                  <Phone className="w-3 h-3 text-[#798580]" />
                  <span>Support Phone</span>
                </label>
                <input
                  value={supportPhone}
                  onChange={(e) => setSupportPhone(e.target.value)}
                  placeholder="e.g. +91 80 4000 1234"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] placeholder-[#9AA5A0] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none"
                  type="text"
                />
              </div>
            </div>

            {/* Row 8: UPI ID (Optional) (Full Width) */}
            <div>
              <label className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[#697670] mb-1.5">
                <span className="font-sans font-bold text-xs text-[#798580]">₹</span>
                <span>UPI ID (Optional)</span>
              </label>
              <input
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-[#D5CEBF] bg-[#FDFBF9] text-[#1D2B26] placeholder-[#9AA5A0] focus:border-[#104945] focus:ring-1 focus:ring-[#104945] outline-none"
                placeholder="e.g. company@upi"
                type="text"
              />
            </div>
          </div>

          {/* Action Button */}
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={savingInvoice}
              className="inline-flex items-center gap-2 bg-[#1B4332] hover:bg-[#123023] text-white px-4 py-2 rounded-xl text-xs font-medium shadow-sm transition-colors cursor-pointer disabled:opacity-50"
            >
              {savingInvoice ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" strokeLinecap="round" strokeLinejoin="round"></path>
                  </svg>
                  <span>Save Invoice Settings</span>
                </>
              )}
            </button>
          </div>
        </form>
      </section>

      {/* ── Advanced Store Policies, Couriers & Reasons (Collapsible) ── */}
      <div className="pt-2">
        <button
          onClick={() => setShowAdvancedPolicies((o) => !o)}
          type="button"
          className="w-full bg-white rounded-2xl px-5 py-3.5 border border-[#E2DBD0] shadow-sm flex items-center justify-between text-xs font-bold text-[#14211D] hover:bg-[#FAF9F7] transition cursor-pointer"
        >
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="w-4 h-4 text-[#104945]" />
            <span>Advanced Policies, Couriers & Return Reasons</span>
          </div>
          {showAdvancedPolicies ? (
            <ChevronUp className="w-4 h-4 text-gray-500" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-500" />
          )}
        </button>

        {showAdvancedPolicies && (
          <div className="space-y-5 mt-4">
            <ReturnPolicyDefaultsCard />
            <CouriersCard />
            <RequestReasonsCard />
          </div>
        )}
      </div>
    </main>
  )
}

export default Optimization