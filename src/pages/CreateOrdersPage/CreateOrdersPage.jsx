import { useState, useCallback, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { useDispatch, useSelector } from "react-redux"
import { callFunction } from "../../utils/edgeFunctions"
import { supabase } from "../../context/SupabaseConfig"
import { toast } from "react-toastify"
import { clearCart } from "../../context/CartSlice"
import { broadcastAuth } from "../../utils/sessionUtils"
import {
  Loader2, CheckCircle2, AlertCircle
} from "lucide-react"

/* ── Pelago Design Tokens ─────────────────────────────────────────── */
const FONT = "'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
const MONO = "'JetBrains Mono', monospace"

/* ── Helper Formatter ────────────────────────────────────────────── */
const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`

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

/* ── Client parser for live preview ──────────────────────────────── */
function clientParse(text) {
  if (!text || !text.trim()) return null
  const clean = text.replace(/\*+/g, "")
  const lines = clean
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)

  const result = {
    customerId: "",
    customerName: "",
    email: "",
    phone: "",
    items: [],
    totalItems: 0,
    subtotal: 0,
    shipping: 0,
    promoCode: "",
    promoDiscount: 0,
    totalAmount: 0,
  }

  const pick = (line) => line.slice(line.indexOf(":") + 1).trim()
  const parsePrice = (str) =>
    parseFloat(String(str).replace(/[^0-9.]/g, "")) || 0

  for (const line of lines) {
    const lc = line.toLowerCase()
    if (lc.startsWith("customer id:") || lc.startsWith("id:")) {
      result.customerId = pick(line)
    } else if (lc.startsWith("customer name:") || lc.startsWith("name:") || lc.startsWith("customer:")) {
      result.customerName = pick(line)
    } else if (lc.startsWith("email:") || lc.startsWith("mail:")) {
      result.email = pick(line)
    } else if (lc.startsWith("phone:") || lc.startsWith("mobile:") || lc.startsWith("contact:")) {
      result.phone = pick(line)
    } else if (/^total items\s*:/.test(lc)) {
      result.totalItems = parseInt(pick(line), 10) || 0
    } else if (/^subtotal\s*:/.test(lc)) {
      result.subtotal = parsePrice(pick(line))
    } else if (/^shipping\s*:/.test(lc)) {
      result.shipping = parsePrice(pick(line))
    } else if (/^promo code\s*:/.test(lc)) {
      const v = pick(line)
      result.promoCode = v === "None" || v === "none" ? "" : v
    } else if (/^promo discount\s*:/.test(lc)) {
      result.promoDiscount = parsePrice(pick(line))
    } else if (/^total amount\s*:/.test(lc) || /^total\s*:/.test(lc)) {
      result.totalAmount = parsePrice(pick(line))
    }
  }

  let i = 0
  while (i < lines.length) {
    const m = lines[i].match(/^(\d+)[.)\s]+(.+)$/)
    if (m) {
      const title = m[2].trim()
      let qty = 0,
        mrp = 0,
        discountPct = 0,
        discountedPrice = 0,
        legacyPrice = 0
      let j = i + 1
      while (j < lines.length) {
        const nl = lines[j].toLowerCase()
        if (nl.startsWith("quantity:") || nl.startsWith("qty:")) {
          qty = parseInt(lines[j].slice(lines[j].indexOf(":") + 1), 10) || 0
          j++
        } else if (nl.startsWith("mrp:")) {
          mrp = parsePrice(lines[j].slice(lines[j].indexOf(":") + 1))
          j++
        } else if (nl.startsWith("discount:")) {
          discountPct =
            parseFloat(
              lines[j]
                .slice(lines[j].indexOf(":") + 1)
                .replace(/%/g, "")
                .trim()
            ) || 0
          j++
        } else if (nl.startsWith("discounted price:")) {
          discountedPrice = parsePrice(
            lines[j].slice(lines[j].indexOf(":") + 1)
          )
          j++
        } else if (nl.startsWith("price:")) {
          legacyPrice = parsePrice(lines[j].slice(lines[j].indexOf(":") + 1))
          j++
        } else if (
          /^\d+[.)\s]/.test(lines[j]) ||
          /^(total|subtotal|shipping|promo)/.test(nl)
        ) {
          break
        } else {
          j++
        }
      }
      if (title && (qty > 0 || mrp > 0 || discountedPrice > 0 || legacyPrice > 0)) {
        result.items.push({
          title,
          quantity: qty || 1,
          price: discountedPrice || mrp || legacyPrice,
          mrp: mrp || legacyPrice,
          discountPct,
        })
      }
      i = j
    } else {
      i++
    }
  }
  return result
}

/* ─────────────────────────────────────────────────────────────────────────
   CREATE ORDERS PAGE (WHATSAPP ORDER)
───────────────────────────────────────────────────────────────────────── */
const CreateOrdersPage = () => {
  const dispatch = useDispatch()
  const navigate = useNavigate()
  const currentUser = useSelector((state) => state.user.user)

  // Empty initial message by default (matches New folder)
  const [message, setMessage] = useState("")
  const [paymentStatus, setPaymentStatus] = useState("paid") // "paid" | "pending"
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [today, setToday] = useState({ count: 0, revenue: 0 })

  /* ── Load real today metrics from Supabase ── */
  useEffect(() => {
    ;(async () => {
      try {
        const { data: rows } = await supabase
          .from("orders")
          .select("id, total, created_at")
          .order("created_at", { ascending: false })
          .limit(200)
        if (rows && rows.length > 0) {
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
  }, [])

  const preview = clientParse(message)
  const hasContent = message.trim().length > 0

  const handleClear = () => {
    setMessage("")
    setResult(null)
  }

  const handleSubmit = useCallback(
    async (allowPriceOverride = false) => {
      if (!hasContent) return
      setLoading(true)
      setResult(null)

      try {
        const { res, data } = await callFunction("orders-manual-create", {
          message,
          paymentStatus,
          allowPriceOverride,
        })

        // Server price mismatch confirmation
        if (res.status === 409 && data.code === "PRICE_MISMATCH") {
          setLoading(false)
          const ok = window.confirm(
            `Price mismatch:\n\nPasted total: ${money(
              data.pastedTotal
            )}\nCatalog total: ${money(data.serverTotal)}\n\n` +
              `Create the order at the pasted (negotiated) price of ${money(
                data.pastedTotal
              )}?`
          )
          if (ok) return handleSubmit(true)
          setResult({
            success: false,
            error: "Order cancelled — price mismatch not confirmed.",
          })
          return
        }

        if (res.ok && data.success) {
          setResult({
            success: true,
            orderId: data.orderId,
            parsedOrder: data.parsedOrder,
          })
          toast.success(`Order ${data.orderId} created successfully!`)

          // Clear cart in Redux & localStorage
          const userUid = currentUser?.uid
          if (userUid) {
            dispatch(clearCart())
            broadcastAuth("cart-clear")
            localStorage.setItem("cart-clear-trigger", Date.now().toString())
          }

          setTimeout(() => {
            navigate("/admin/myorders")
          }, 1500)
        } else {
          setResult({
            success: false,
            error: data.error || "Failed to create order",
          })
          toast.error(data.error || "Failed to create order")
        }
      } catch (err) {
        const msg = err.message || "Network error — could not reach the server"
        setResult({ success: false, error: msg })
        toast.error(msg)
      } finally {
        setLoading(false)
      }
    },
    [message, paymentStatus, hasContent, dispatch, currentUser, navigate]
  )

  /* Derived customer values — ONLY from parsed preview */
  const customerName = preview?.customerName || ""
  const customerEmail = preview?.email || ""
  const customerPhone = preview?.phone || ""

  /* Derived item values — ONLY from parsed preview */
  const itemsList = preview?.items || []
  const itemsCount =
    preview?.totalItems || itemsList.reduce((s, i) => s + (i.quantity || 1), 0)
  const totalAmount =
    Number(preview?.totalAmount) > 0
      ? Number(preview.totalAmount)
      : itemsList.reduce(
          (s, i) => s + Number(i.price || 0) * Number(i.quantity || 1),
          0
        ) +
        Number(preview?.shipping || 0) -
        Number(preview?.promoDiscount || 0)

  return (
    <main
      style={{ fontFamily: FONT }}
      className="flex-1 w-full min-w-0 text-[#222B29] pb-16 pr-4 sm:pr-6 md:pr-8 lg:pr-10 max-w-[1440px]"
      data-purpose="main-content-area"
    >
      <style>{`
        .custom-scroll::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scroll::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scroll::-webkit-scrollbar-thumb {
          background: #D8D2C7;
          border-radius: 4px;
        }
      `}</style>

      {/* ── BEGIN: PageHeader ── */}
      <header
        className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5"
        data-purpose="page-header"
      >
        <div>
          <h1 className="text-[22px] lg:text-[24px] font-bold text-[#172220] tracking-tight">
            Create Manual Order
          </h1>
          <p className="text-[12px] text-gray-600 mt-0.5">
            Paste a WhatsApp order message. The backend will parse, validate, and
            create the order using the same pipeline as online payments.
          </p>
        </div>

        {/* Header Actions: Status Pill & Action Buttons */}
        <div
          className="flex items-center gap-2 shrink-0"
          data-purpose="header-controls"
        >
          {/* Daily Metric Pill */}
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-white rounded-full border border-stone-200 text-[12px] font-medium text-gray-700 shadow-sm">
            <span className="w-2 h-2 rounded-full bg-[#1B4D3E]"></span>
            <span>
              {today.count} today{" "}
              <span className="text-gray-400">
                {today.revenue >= 1000
                  ? `₹${Math.round(today.revenue / 1000)}k`
                  : `₹${Math.round(today.revenue)}`}
              </span>
            </span>
          </div>

          {/* Moon Dark Mode Toggle */}
          <button
            onClick={() => toast.info("Dark mode toggled.")}
            className="w-8 h-8 rounded-full bg-white border border-stone-200 flex items-center justify-center text-gray-600 hover:text-gray-900 shadow-sm transition cursor-pointer"
            title="Toggle theme"
            type="button"
          >
            <svg
              className="w-4 h-4 fill-none stroke-current stroke-2"
              viewBox="0 0 24 24"
            >
              <path
                d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z"
                strokeLinecap="round"
                strokeLinejoin="round"
              ></path>
            </svg>
          </button>

          {/* Notifications Bell with Red Dot */}
          <button
            onClick={() => toast.info("No unread notifications.")}
            className="w-8 h-8 rounded-full bg-white border border-stone-200 flex items-center justify-center text-gray-600 hover:text-gray-900 shadow-sm relative transition cursor-pointer"
            title="Notifications"
            type="button"
          >
            <svg
              className="w-4 h-4 fill-none stroke-current stroke-2"
              viewBox="0 0 24 24"
            >
              <path
                d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0"
                strokeLinecap="round"
                strokeLinejoin="round"
              ></path>
            </svg>
            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-[#E05844] rounded-full border border-white"></span>
          </button>
        </div>
      </header>
      {/* ── END: PageHeader ── */}

      {/* ── Result Feedback Banner (if any) ── */}
      {result && (
        <div
          className={`mb-5 p-4 rounded-2xl border flex items-center justify-between gap-3 ${
            result.success
              ? "bg-[#DDF0EB] border-[#A7D7C5] text-[#0F6848]"
              : "bg-[#FEE2E2] border-[#F8B4B4] text-[#991B1B]"
          }`}
        >
          <div className="flex items-center gap-3">
            {result.success ? (
              <CheckCircle2 className="w-5 h-5 shrink-0" />
            ) : (
              <AlertCircle className="w-5 h-5 shrink-0" />
            )}
            <div>
              <div className="font-bold text-xs">
                {result.success
                  ? `Order #${result.orderId} created successfully!`
                  : "Order Creation Failed"}
              </div>
              <div className="text-[11px] opacity-80">
                {result.success
                  ? "Stock deducted, order status updated, and customer notification dispatched."
                  : result.error}
              </div>
            </div>
          </div>
          <button
            onClick={() => setResult(null)}
            className="text-xs font-semibold underline opacity-70 hover:opacity-100 cursor-pointer"
            type="button"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── BEGIN: ContentGrid ── */}
      <div
        className="grid grid-cols-1 lg:grid-cols-12 gap-5"
        data-purpose="main-layout-grid"
      >
        {/* ═══════════ Column 1: Large WhatsApp Message Box & Action (7 cols) ═══════════ */}
        <section
          className="lg:col-span-7 flex flex-col"
          data-purpose="whatsapp-input-container"
        >
          <div className="bg-white rounded-[26px] p-5 shadow-sm border border-[#E8E2D8] flex-1 flex flex-col justify-between">
            <div className="flex-1 flex flex-col">
              <div className="text-[11px] font-bold tracking-wider text-gray-600 uppercase mb-3">
                Paste WhatsApp Order
              </div>

              {/* Message Display / Editable Box */}
              <textarea
                value={message}
                onChange={(e) => {
                  setMessage(e.target.value)
                  setResult(null)
                }}
                style={{ fontFamily: MONO }}
                className="w-full flex-1 bg-[#FAF9F7] border border-[#DED8CE] rounded-xl p-4 custom-scroll overflow-y-auto text-[13px] leading-relaxed text-gray-800 min-h-[460px] whitespace-pre-wrap select-text focus:outline-none focus:ring-1 focus:ring-[#104945]/30 focus:border-[#104945] transition-all resize-none"
                placeholder={`Paste the entire WhatsApp order here...\n\nExample:\nCustomer Name: Satish\nEmail: satish@example.com\nPhone: 9945876522\n\n1. Product Name\nQuantity: 2\nPrice: 499\n\nTotal Items : 2\nSubtotal : 998\nTotal Amount : 998`}
              />
            </div>

            {/* Bottom Actions: Create Order & Trash Bin */}
            <div
              className="flex items-center justify-center gap-3 pt-5 mt-4"
              data-purpose="order-actions"
            >
              <button
                onClick={() => handleSubmit(false)}
                disabled={loading || !hasContent}
                className="bg-[#104945] hover:bg-[#0b3532] text-white px-5 py-2 rounded-xl text-[13px] font-semibold flex items-center gap-2 shadow-sm transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                type="button"
              >
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Processing...</span>
                  </>
                ) : (
                  <>
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      viewBox="0 0 24 24"
                    >
                      <rect height="14" rx="2" width="20" x="2" y="5"></rect>
                      <line x1="2" x2="22" y1="10" y2="10"></line>
                    </svg>
                    <span>Create Order</span>
                  </>
                )}
              </button>

              <button
                onClick={handleClear}
                disabled={loading || !message}
                className="w-9 h-9 rounded-xl border border-[#DED8CE] bg-white hover:bg-stone-50 flex items-center justify-center text-gray-600 shadow-sm transition cursor-pointer disabled:opacity-50"
                title="Clear message"
                type="button"
              >
                <svg
                  className="w-4 h-4 stroke-[1.8]"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  ></path>
                </svg>
              </button>
            </div>
          </div>
        </section>

        {/* ═══════════ Column 2: Parsed Info (Customer & Items) (5 cols) ═══════════ */}
        <section
          className="lg:col-span-5 flex flex-col gap-4"
          data-purpose="parsed-info-container"
        >
          {/* Card 1: Parsed Customer Details */}
          <div
            className="bg-white rounded-[26px] p-5 shadow-sm border border-[#E8E2D8]"
            data-purpose="parsed-customer"
          >
            <div className="flex items-center justify-between mb-3.5">
              <h2 className="text-[15px] font-bold text-gray-900 tracking-tight">
                Parsed Customer
              </h2>
              {hasContent && (customerName || customerEmail || customerPhone) && (
                <span className="text-[10px] font-semibold text-[#0F6848] bg-[#DDF0EB] px-2 py-0.5 rounded-full">
                  Detected
                </span>
              )}
            </div>

            {hasContent && (customerName || customerEmail || customerPhone) ? (
              <div className="space-y-3">
                {/* Customer Name */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-[#EAE7E1] flex items-center justify-center shrink-0">
                    <div className="w-6 h-6 rounded-full bg-[#DDD7CD] flex items-center justify-center text-[10px] font-bold text-gray-700">
                      {(customerName || "U").slice(0, 2).toUpperCase()}
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      Name
                    </div>
                    <div className="text-[12.5px] font-bold text-gray-900">
                      {customerName || "—"}
                    </div>
                  </div>
                </div>

                {/* Customer Email */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#4A5D4E] flex items-center justify-center shrink-0">
                    <div className="w-5 h-5 rounded-lg bg-[#3C4E40] flex items-center justify-center text-white text-[10px]">
                      @
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      Email
                    </div>
                    <div className="text-[12px] font-medium text-gray-800">
                      {customerEmail || "—"}
                    </div>
                  </div>
                </div>

                {/* Customer Phone */}
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#E2C7A8] flex items-center justify-center shrink-0">
                    <div className="w-4 h-6 rounded-sm bg-[#CEAF8D] flex items-center justify-center text-white text-[10px]">
                      #
                    </div>
                  </div>
                  <div>
                    <div className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">
                      Phone
                    </div>
                    <div className="text-[12.5px] font-medium text-gray-800">
                      {customerPhone || "—"}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-6 text-gray-400 text-[13px] bg-[#FAF9F7] rounded-xl border border-dashed border-[#DED8CE]">
                Paste a WhatsApp message to see parsed customer preview
              </div>
            )}
          </div>

          {/* Card 2: Parsed Items & Payment Flow */}
          <div
            className="bg-white rounded-[26px] p-5 shadow-sm border border-[#E8E2D8] flex-1 flex flex-col justify-between"
            data-purpose="parsed-items"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-[14.5px] font-bold text-gray-900 tracking-tight">
                  Parsed Items {itemsList.length > 0 ? `(${itemsList.length})` : ""}
                </h2>
                <Link
                  className="text-[11px] font-medium text-gray-800 underline hover:text-black cursor-pointer"
                  to="/admin/myorders"
                >
                  All orders
                </Link>
              </div>

              {/* Items List or Empty state */}
              {itemsList.length > 0 ? (
                <>
                  <div
                    className="space-y-3 mb-4 max-h-[340px] overflow-y-auto pr-1 custom-scroll"
                    data-purpose="order-item-list"
                  >
                    {itemsList.map((item, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="w-9 h-9 rounded-xl bg-[#E4E8DF] flex items-center justify-center shrink-0">
                            <div className="w-5 h-5 rounded-md bg-[#4B5947] flex items-center justify-center text-white text-[10px] font-bold">
                              {idx + 1}
                            </div>
                          </div>
                          <div className="min-w-0">
                            <div className="text-[12.5px] font-bold text-gray-900 leading-snug truncate">
                              {item.title}
                            </div>
                            <div className="text-[10px] text-gray-400 font-medium">
                              Qty: {item.quantity}
                            </div>
                          </div>
                        </div>
                        <div className="text-[13px] font-bold text-gray-900 shrink-0">
                          {money(item.price * item.quantity)}
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Subtotal, Shipping, Promo Breakdown */}
                  {(preview?.shipping > 0 || preview?.promoDiscount > 0 || preview?.subtotal > 0) && (
                    <div className="border-t border-dashed border-gray-200 pt-2.5 my-2 space-y-1.5 text-[11px]">
                      {preview?.subtotal > 0 && (
                        <div className="flex justify-between text-gray-600">
                          <span>Subtotal</span>
                          <span className="font-semibold text-gray-800">{money(preview.subtotal)}</span>
                        </div>
                      )}
                      {preview?.shipping > 0 && (
                        <div className="flex justify-between text-gray-600">
                          <span>Shipping</span>
                          <span className="font-semibold text-gray-800">{money(preview.shipping)}</span>
                        </div>
                      )}
                      {preview?.promoDiscount > 0 && (
                        <div className="flex justify-between text-[#0F6848]">
                          <span>Promo Discount {preview.promoCode ? `(${preview.promoCode})` : ""}</span>
                          <span className="font-semibold">-{money(preview.promoDiscount)}</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Dotted Divider */}
                  <div className="border-t border-dashed border-gray-200 my-3"></div>

                  {/* Total Row */}
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-[13px] font-medium text-gray-800">
                      Total ({itemsCount} items)
                    </span>
                    <span className="text-[17px] font-bold text-gray-900">
                      {money(totalAmount)}
                    </span>
                  </div>
                </>
              ) : (
                <div className="text-center py-8 text-gray-400 text-[13px] bg-[#FAF9F7] rounded-xl border border-dashed border-[#DED8CE] mb-4">
                  No items detected yet. Paste a WhatsApp order message on the left to see parsed items.
                </div>
              )}
            </div>

            {/* Payment Status Buttons */}
            <div
              className="flex items-center gap-3 pt-2"
              data-purpose="payment-actions"
            >
              <button
                onClick={() => setPaymentStatus("pending")}
                className={`flex-1 bg-[#CF6D63] hover:bg-[#ba5e54] text-white py-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 shadow-sm transition cursor-pointer ${
                  paymentStatus === "pending"
                    ? "ring-2 ring-offset-1 ring-[#CF6D63]"
                    : "opacity-90 hover:opacity-100"
                }`}
                type="button"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <rect height="14" rx="2" width="20" x="2" y="5"></rect>
                  <line x1="2" x2="22" y1="10" y2="10"></line>
                </svg>
                <span>Not Paid</span>
              </button>

              <button
                onClick={() => setPaymentStatus("paid")}
                className={`flex-1 bg-[#104945] hover:bg-[#0b3532] text-white py-2.5 rounded-xl text-[13px] font-semibold flex items-center justify-center gap-2 shadow-sm transition cursor-pointer ${
                  paymentStatus === "paid"
                    ? "ring-2 ring-offset-1 ring-[#104945]"
                    : "opacity-90 hover:opacity-100"
                }`}
                type="button"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  viewBox="0 0 24 24"
                >
                  <rect height="14" rx="2" width="20" x="2" y="5"></rect>
                  <line x1="2" x2="22" y1="10" y2="10"></line>
                </svg>
                <span>Paid</span>
              </button>
            </div>
          </div>
        </section>
      </div>
      {/* ── END: ContentGrid ── */}
    </main>
  )
}

export default CreateOrdersPage