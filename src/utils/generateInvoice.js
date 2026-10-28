import { jsPDF } from "jspdf"
import autoTable from "jspdf-autotable"
import { getInvoiceSettings } from "../services/settingsService"

/**
 * @typedef {Object} OrderProduct
 * @property {string} [title]    Product name
 * @property {string} [sku]      SKU / item code
 * @property {number} [price]    Unit price (GST-inclusive)
 * @property {number} [quantity] Quantity ordered
 * @property {string} [category] Product category
 */

/**
 * @typedef {Object} Order
 * @property {string} id
 * @property {string} [orderId]
 * @property {string} [userName]
 * @property {string} [userEmail]
 * @property {string} [userPhone]
 * @property {string} [address]
 * @property {string} [shippingAddress]
 * @property {number} [total]
 * @property {string} [paymentMethod]
 * @property {string} [paymentStatus]
 * @property {*}      [createdAt]   Firestore Timestamp | ISO string | Date
 * @property {OrderProduct[]} [products]
 */

/* ============================== CONFIG ============================== */
const COMPANY = {
    name: "Nexus Commerce Pvt. Ltd.",
    address: "12 Industrial Layout, Whitefield, Bengaluru, Karnataka 560066",
    gstin: "29ABCDE1234F1Z5",
    state: "Karnataka",
    email: "support@nexuscommerce.in",
    phone: "+91 80 4000 1234",
}
// Per-product GST is stored on each order line item (order.products[i].gstRate).
// This fallback rate is used ONLY for legacy orders created before per-product
// GST existed — prices are treated as GST-inclusive (India retail convention).
const LEGACY_GST_RATE = 18
const CUR = "Rs. "

/* ============================== HELPERS ============================== */
/** Strip HTML tags + collapse whitespace from any value, with a fallback. */
const clean = (v, fallback = "N/A") => {
    const s = String(v ?? "").replace(/<[^>]*>/g, "").trim()
    return s === "" ? fallback : s
}
/** Format a number as a 2-decimal money string. */
const money = (n) => `${CUR}${Number(n || 0).toFixed(2)}`
/** Coerce a Firestore Timestamp / ISO string / Date into a JS Date (or null). */
const toDate = (v) => {
    if (!v) return null
    if (v?.toDate) return v.toDate()
    const d = new Date(v)
    return isNaN(d.getTime()) ? null : d
}
/** Format a date as "DD Mon YYYY", or "N/A". */
const fmtDate = (d) => (d && !isNaN(d.getTime()) ? d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "N/A")
/** Make a string safe for a filename. */
const fileSafe = (s) => String(s || "").replace(/[^a-z0-9_-]+/gi, "_").replace(/^_+|_+$/g, "") || "NA"

/**
 * Normalise an address that may be a plain string OR the profile/order object
 * shape ({ street, city, state, pincode, country }) into a single readable
 * line. Returns "" when nothing usable is present so callers can fall through
 * to the next candidate.
 */
const formatAddress = (v) => {
    if (!v) return ""
    if (typeof v === "string") return v.replace(/<[^>]*>/g, "").trim()
    if (typeof v === "object") {
        return [v.street, v.city, v.state, v.pincode, v.country]
            .map((s) => String(s ?? "").replace(/<[^>]*>/g, "").trim())
            .filter(Boolean)
            .join(", ")
    }
    return ""
}

/** Load an image from an external URL and resolve an HTML Image Element. */
const loadImage = (url) => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = "Anonymous"; // Prevent CORS issues
        img.onload = () => resolve(img);
        img.onerror = (err) => reject(err);
        img.src = url;
    });
};

/**
 * Generate and download a professional A4 PDF tax invoice for an order,
 * fully client-side. Safe to call from both user and admin pages.
 *
 * @param {Order} order               The order document.
 * @param {Object} [userDetails={}]   Optional customer details ({name,email,phone,address,state}).
 * @returns {Promise<void>}
 */
export async function generateInvoice(order, userDetails = {}) {
    if (!order) return

    // Fetch customizable settings from Firestore or fall back to defaults
    let invoiceSettings = null;
    try {
        invoiceSettings = await getInvoiceSettings();
    } catch (error) {
        console.error("Error fetching invoice settings for PDF:", error);
    }

    const settings = invoiceSettings || {};
    console.log("DEBUG: Fetched Invoice Settings:", invoiceSettings);
    const companyName = settings.companyName || COMPANY.name;
    const address = settings.address || COMPANY.address;
    const email = settings.email || COMPANY.email;
    const phone = settings.mobile || settings.phone || COMPANY.phone;
    const gstin = settings.gstin || COMPANY.gstin;
    const website = settings.website || "";

    // Pre-load company logo image if URL is configured
    let logoImg = null;
    if (settings.logo) {
        try {
            logoImg = await loadImage(settings.logo);
        } catch (error) {
            console.error("Failed to load invoice logo image:", error);
        }
    }

    const doc = new jsPDF({ unit: "pt", format: "a4" })
    const M = 40
    const pageW = doc.internal.pageSize.getWidth()
    const pageH = doc.internal.pageSize.getHeight()
    const contentW = pageW - M * 2
    const rightX = pageW - M

    /* ---- identifiers ---- */
    const rawId = order.externalOrderId ? String(order.externalOrderId).replace(/^#/, "") : (order.orderId || order.id || "")
    const now = new Date()
    const invDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`
    const invoiceNo = `INV-${invDate}-${rawId}`
    const orderDate = fmtDate(toDate(order.createdAt))
    const customerName = clean(userDetails.name || order.userName, "Guest Customer")

    /* ---- line items + tax maths ---- */
    const products = Array.isArray(order.products) ? order.products : []
    let itemsTotal = 0

    const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100

    // Whether this order carries server-computed GST, and whether it's an
    // inter-state sale (IGST) vs intra-state (CGST+SGST). Determined up front so
    // the items table can choose its columns per order.
    const isGstDisabled = order.gstEnabled === false || (order.gstEnabled === undefined && settings.gstEnabled === false)
    const hasStoredGst = !isGstDisabled && order.taxableTotal != null
    const interState = hasStoredGst
        ? !!order.isInterState
        : (!!userDetails.state && clean(userDetails.state, "").toLowerCase() !== (settings.state || COMPANY.state).toLowerCase())

    const getItemFinalPrice = (p) => {
        const mrp = Number(p.originalPrice ?? p.price ?? 0)
        const disc = Number(p.discount || 0)
        const stored = Number(p.finalPrice ?? p.price ?? 0)
        if (disc > 0 && stored >= mrp && mrp > 0) {
            return Math.round(mrp * (1 - disc / 100) * 100) / 100
        }
        return stored || mrp
    }

    // One pass computes every per-line figure; the items table, the HSN tax
    // summary, and the totals are all derived from these `lines`.
    const lines = products.map((p, i) => {
        const qty = Number(p.quantity) || 1
        const mrp = Number(p.originalPrice ?? p.price ?? p.finalPrice) || 0
        const unit = getItemFinalPrice(p)
        const discAmt = Math.max(0, Number((mrp - unit).toFixed(2)))
        const discPct = discAmt > 0
            ? (Number(p.discount) > 0 ? `${Math.round(Number(p.discount))}%` : `${Math.round((discAmt / mrp) * 100)}%`)
            : "0%"
        const lineTotal = unit * qty
        itemsTotal += lineTotal
        // Per-product GST rate (legacy orders fall back to the old global rate).
        const gstRate = p.gstRate != null ? Number(p.gstRate) : LEGACY_GST_RATE
        // Prefer the taxable value stored with the order (per unit); otherwise
        // back-calculate from the GST-inclusive unit price.
        const taxableUnit = Number(p.taxableValue) || (gstRate > 0 ? unit * 100 / (100 + gstRate) : unit)
        const taxable = taxableUnit * qty
        const lineGst = round2((unit - taxableUnit) * qty)
        // Per-item CGST/SGST/IGST — prefer stored amounts, else derive from the
        // order's intra/inter-state flag (CGST=ceil, SGST=floor → sum is exact).
        let cgst, sgst, igst
        if (p.cgstAmount != null || p.sgstAmount != null || p.igstAmount != null) {
            cgst = Number(p.cgstAmount || 0); sgst = Number(p.sgstAmount || 0); igst = Number(p.igstAmount || 0)
        } else if (interState) {
            igst = lineGst; cgst = 0; sgst = 0
        } else {
            cgst = Math.ceil((lineGst / 2) * 100) / 100; sgst = Math.floor((lineGst / 2) * 100) / 100; igst = 0
        }
        const name = discAmt > 0
            ? `${clean(p.title, "Item")} (${discPct} off Rs.${mrp.toFixed(2)})`
            : clean(p.title, "Item")
        return { idx: i + 1, name, hsn: clean(p.hsnCode, "-"), qty, unit, gstRate, taxable, cgst, sgst, igst, lineTotal }
    })

    const body = lines.map((l) => {
        const common = [String(l.idx), l.name, l.hsn, String(l.qty), money(l.unit), `${Math.round(l.gstRate)}%`, money(l.taxable)]
        return interState
            ? [...common, money(l.igst), money(l.lineTotal)]
            : [...common, money(l.cgst), money(l.sgst), money(l.lineTotal)]
    })
    if (body.length === 0) {
        const empty = ["1", "N/A", "-", "0", money(0), "0%", money(0)]
        body.push(interState ? [...empty, money(0), money(0)] : [...empty, money(0), money(0), money(0)])
    }

    // Group taxable value + tax by (HSN, GST rate) for the tax-summary table.
    const groupMap = new Map()
    for (const l of lines) {
        const key = `${l.hsn}||${l.gstRate}`
        const g = groupMap.get(key) || { hsn: l.hsn, rate: l.gstRate, taxable: 0, cgst: 0, sgst: 0, igst: 0 }
        g.taxable += l.taxable; g.cgst += l.cgst; g.sgst += l.sgst; g.igst += l.igst
        groupMap.set(key, g)
    }
    const taxGroups = [...groupMap.values()].sort((a, b) => a.rate - b.rate)

    const grand = Number(order.total) || itemsTotal
    const promoDiscount = Number(order.promoDiscount ?? 0)
    const promoCode = order.promoCode || ""
    const storedShipping = Number(order.shipping ?? 0)
    const derivedShipping = Math.max(0, Math.round((grand - itemsTotal + promoDiscount) * 100) / 100)
    const shipping = storedShipping > 0 ? storedShipping : derivedShipping
    const goodsValue = itemsTotal

    // GST summary — prefer the totals stored with the order (per-product, computed
    // server-side). Legacy orders without stored GST fall back to a single rate.
    let taxableTotal, totalCgst, totalSgst, totalIgst
    if (hasStoredGst) {
        taxableTotal = Number(order.taxableTotal) || 0
        totalCgst = Number(order.totalCgst || 0)
        totalSgst = Number(order.totalSgst || 0)
        totalIgst = Number(order.totalIgst || 0)
    } else {
        taxableTotal = goodsValue / (1 + LEGACY_GST_RATE / 100)
        const gstTotal = goodsValue - taxableTotal
        if (interState) { totalIgst = gstTotal; totalCgst = 0; totalSgst = 0 }
        else { totalCgst = gstTotal / 2; totalSgst = gstTotal / 2; totalIgst = 0 }
    }

    /* ============================== HEADER ============================== */
    let textY = M;
    const logoSize = 40;

    if (logoImg) {
        try {
            doc.addImage(logoImg, "PNG", M, M, logoSize, logoSize);
        } catch (e) {
            console.error("Failed to add logo to jsPDF document:", e);
        }
        doc.setFont("helvetica", "bold")
        doc.setFontSize(20)
        doc.setTextColor(40, 20, 180)
        doc.text(companyName, M + 50, M + 15)

        doc.setFont("helvetica", "normal")
        doc.setFontSize(9)
        doc.setTextColor(70, 68, 85)
        textY = M + 50;
    } else {
        doc.setFont("helvetica", "bold")
        doc.setFontSize(20)
        doc.setTextColor(40, 20, 180)
        doc.text(companyName, M, M + 6)

        doc.setFont("helvetica", "normal")
        doc.setFontSize(9)
        doc.setTextColor(70, 68, 85)
        textY = M + 24;
    }

    // Render company address rows
    if (address) {
        doc.text(address, M, textY);
        textY += 14;
    }

    // Render email | mobile/phone | website dynamically
    const contactParts = [];
    if (email) contactParts.push(email);
    if (phone) contactParts.push(phone);
    if (website) contactParts.push(website);
    if (contactParts.length > 0) {
        doc.text(contactParts.join("  |  "), M, textY);
        textY += 14;
    }

    // Render GSTIN number if available
    if (gstin) {
        doc.text(`GSTIN: ${gstin}`, M, textY);
        textY += 14;
    }

    const separatorY = Math.max(textY + 4, M + 64);

    // draw separator line
    doc.setDrawColor(199, 196, 215)
    doc.line(M, separatorY, rightX, separatorY)

    // "TAX INVOICE" label (right)
    doc.setFont("helvetica", "bold")
    doc.setFontSize(18)
    doc.setTextColor(25, 28, 30)
    doc.text("TAX INVOICE", rightX, M + 6, { align: "right" })

    doc.setFont("helvetica", "normal")
    doc.setFontSize(9)
    doc.setTextColor(70, 68, 85)
    doc.text(`Invoice No: ${invoiceNo}`, rightX, M + 20, { align: "right" })
    doc.text(`Invoice Date: ${fmtDate(now)}`, rightX, M + 38, { align: "right" })
    doc.text(`Order Date: ${orderDate}`, rightX, M + 52, { align: "right" })

    /* ============================== BILL TO / SHIP TO ============================== */
    // Orders persist the delivery address as `userAddress` (string OR object);
    // fall back through every known field/shape so the invoice is never blank
    // regardless of payment method (Razorpay / WhatsApp / COD).
    const addr = clean(
        formatAddress(userDetails.address) ||
        formatAddress(order.userAddress) ||
        formatAddress(order.address) ||
        formatAddress(order.shippingAddress),
        "Address not on file",
    )
    const emailVal = clean(userDetails.email || order.userEmail)
    const phoneVal = clean(userDetails.phone || order.userPhone)
    let y = separatorY + 20

    const colGap = contentW / 2
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(25, 28, 30)
    doc.text("BILL TO", M, y)
    doc.text("SHIP TO", M + colGap, y)
    doc.setFont("helvetica", "normal"); doc.setFontSize(9); doc.setTextColor(70, 68, 85)

    const billLines = [customerName, emailVal, phoneVal, ...doc.splitTextToSize(addr, colGap - 16)]
    const shipLines = [customerName, phoneVal, ...doc.splitTextToSize(addr, colGap - 16)]
    billLines.forEach((l, i) => doc.text(String(l), M, y + 16 + i * 13))
    shipLines.forEach((l, i) => doc.text(String(l), M + colGap, y + 16 + i * 13))
    y += 16 + Math.max(billLines.length, shipLines.length) * 13 + 12

    /* ============================== ITEMS TABLE ============================== */
    // Columns adapt to the sale type: inter-state shows a single IGST column,
    // intra-state splits it into CGST + SGST. Discount stays in the product name.
    const tableHead = interState
        ? [["#", "Product", "HSN", "Qty", "Unit", "GST", "Taxable", "IGST", "Total"]]
        : [["#", "Product", "HSN", "Qty", "Unit", "GST", "Taxable", "CGST", "SGST", "Total"]]
    const tableColumnStyles = isGstDisabled
        ? {
            0: { halign: "center", cellWidth: 20 },
            1: { cellWidth: "auto" },
            2: { halign: "center", cellWidth: 36 },
            3: { halign: "right", cellWidth: 70 },
            4: { halign: "right", cellWidth: 80 },
        }
        : interState
            ? {
                0: { halign: "center", cellWidth: 18 },
                1: { cellWidth: "auto" },
                2: { halign: "center", cellWidth: 44 },
                3: { halign: "center", cellWidth: 22 },
                4: { halign: "right", cellWidth: 52 },
                5: { halign: "center", cellWidth: 30 },
                6: { halign: "right", cellWidth: 56 },
                7: { halign: "right", cellWidth: 56 },
                8: { halign: "right", cellWidth: 58 },
            }
            : {
                0: { halign: "center", cellWidth: 18 },
                1: { cellWidth: "auto" },
                2: { halign: "center", cellWidth: 42 },
                3: { halign: "center", cellWidth: 22 },
                4: { halign: "right", cellWidth: 50 },
                5: { halign: "center", cellWidth: 30 },
                6: { halign: "right", cellWidth: 54 },
                7: { halign: "right", cellWidth: 50 },
                8: { halign: "right", cellWidth: 50 },
                9: { halign: "right", cellWidth: 56 },
            }
    autoTable(doc, {
        startY: y,
        margin: { left: M, right: M },
        head: tableHead,
        body,
        styles: { font: "helvetica", fontSize: 7, cellPadding: 4, textColor: [40, 40, 50], lineColor: [225, 224, 235], lineWidth: 0.5 },
        headStyles: { fillColor: [40, 20, 180], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
        alternateRowStyles: { fillColor: [248, 247, 252] },
        columnStyles: tableColumnStyles,
    })

    /* ============================== TAX SUMMARY (by HSN / rate) ============================== */
    const pageBottom = pageH - M
    const ensure = (yy, need) => (yy + need > pageBottom ? (doc.addPage(), M) : yy)

    if (!isGstDisabled) {
        // Clean pagination for everything drawn after the (auto-paginating) items
        // table: if a block won't fit above the bottom margin, start a fresh page.
        const taxLabelY = ensure(doc.lastAutoTable.finalY + 20, 64)
        doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(25, 28, 30)
        doc.text("TAX SUMMARY", M, taxLabelY)

        const taxHead = interState
            ? [["HSN / SAC", "Rate", "Taxable", "IGST", "Total Tax"]]
            : [["HSN / SAC", "Rate", "Taxable", "CGST", "SGST", "Total Tax"]]
        const taxBody = taxGroups.map((g) => {
            const totalTax = interState ? g.igst : (g.cgst + g.sgst)
            const common = [g.hsn, `${Math.round(g.rate)}%`, money(g.taxable)]
            return interState
                ? [...common, money(g.igst), money(totalTax)]
                : [...common, money(g.cgst), money(g.sgst), money(totalTax)]
        })
        // Total row across all HSN groups.
        const sumTax = taxGroups.reduce((a, g) => ({
            taxable: a.taxable + g.taxable, cgst: a.cgst + g.cgst, sgst: a.sgst + g.sgst, igst: a.igst + g.igst,
        }), { taxable: 0, cgst: 0, sgst: 0, igst: 0 })
        const totalRow = interState
            ? ["Total", "", money(sumTax.taxable), money(sumTax.igst), money(sumTax.igst)]
            : ["Total", "", money(sumTax.taxable), money(sumTax.cgst), money(sumTax.sgst), money(sumTax.cgst + sumTax.sgst)]

        autoTable(doc, {
            startY: taxLabelY + 6,
            margin: { left: M, right: M },
            tableWidth: "wrap",
            head: taxHead,
            body: taxBody.length ? [...taxBody, totalRow] : [totalRow],
            styles: { font: "helvetica", fontSize: 7, cellPadding: 4, textColor: [40, 40, 50], lineColor: [225, 224, 235], lineWidth: 0.5 },
            headStyles: { fillColor: [70, 68, 85], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
            columnStyles: {
                0: { cellWidth: 70 },
                1: { halign: "center", cellWidth: 40 },
                2: { halign: "right", cellWidth: 72 },
                3: { halign: "right", cellWidth: 62 },
                4: { halign: "right", cellWidth: 62 },
                5: { halign: "right", cellWidth: 62 },
            },
            // Bold the trailing Total row.
            didParseCell: (data) => {
                if (data.section === "body" && data.row.index === (taxBody.length ? taxBody.length : 0)) {
                    data.cell.styles.fontStyle = "bold"
                }
            },
        })

    }
    /* ============================== SUMMARY + PAYMENT ============================== */
    // Keep the summary (right) and payment (left) blocks together on one page.
    const txnId = clean(order.razorpayPaymentId, "")
    const summaryRows = 1 + (interState ? 1 : 2) + 1 + (promoDiscount > 0 ? 1 : 0)
    const summaryHeight = summaryRows * 14 + 18 + 8
    const paymentHeight = txnId ? 48 : 32
    const blockTop = ensure(doc.lastAutoTable.finalY + 18, Math.max(summaryHeight, paymentHeight))

    let sy = blockTop
    const labelX = rightX - 200
    const valX = rightX
    const row = (label, value, opts = {}) => {
        doc.setFont("helvetica", opts.bold ? "bold" : "normal")
        doc.setFontSize(opts.bold ? 11 : 9)
        doc.setTextColor(...(opts.color || [70, 68, 85]))
        doc.text(label, labelX, sy)
        doc.text(value, valX, sy, { align: "right" })
        sy += opts.bold ? 18 : 14
    }
    row("Subtotal (Taxable)", money(taxableTotal))
    if (interState) {
        row("IGST", money(totalIgst))
    } else {
        row("CGST", money(totalCgst))
        row("SGST", money(totalSgst))
    }
    row("Shipping", shipping === 0 ? "FREE" : money(shipping))
    if (promoDiscount > 0) {
        row(`Promo Discount${promoCode ? ` (${promoCode})` : ""}`, `-${money(promoDiscount)}`, { color: [21, 128, 61] })
    }
    doc.setDrawColor(199, 196, 215); doc.line(labelX, sy - 4, valX, sy - 4)
    row("Grand Total", money(grand), { bold: true, color: [40, 20, 180] })

    /* ---- payment block (left, aligned with summary) ---- */
    let py = blockTop
    doc.setFont("helvetica", "bold"); doc.setFontSize(9); doc.setTextColor(25, 28, 30)
    doc.text("Payment Method:", M, py)
    doc.text("Payment Status:", M, py + 16)
    if (txnId) doc.text("Transaction ID:", M, py + 32)
    doc.setFont("helvetica", "normal"); doc.setTextColor(70, 68, 85)
    // Friendly wording for Cash-on-Delivery orders.
    const payMethodStr = String(order.paymentMethod || "").toLowerCase() === "cod"
        ? "Cash on Delivery (COD)"
        : clean(order.paymentMethod, "N/A")
    const payStatusStr = String(order.paymentStatus || "").toLowerCase() === "pending"
        ? "UNPAID / PENDING ON DELIVERY"
        : clean(order.paymentStatus, "N/A").toUpperCase()
    doc.text(payMethodStr, M + 95, py)
    doc.text(payStatusStr, M + 95, py + 16)
    if (txnId) doc.text(txnId, M + 95, py + 32)
    const payBottom = txnId ? py + 32 : py + 16

    /* ============================== FOOTER ============================== */
    // Footer needs ~100pt; if it won't fit under the blocks, move to a new page.
    let fy = ensure(Math.max(sy, payBottom) + 40, 100)
    // dotted separator
    doc.setLineDashPattern([2, 2], 0)
    doc.setDrawColor(199, 196, 215)
    doc.line(M, fy, rightX, fy)
    doc.setLineDashPattern([], 0)

    let footerY = fy + 20;

    // Footer Title (Default "Thank You!" if settings empty or not set)
    const footerTitleText = settings.footerTitle || "Thank You!";
    doc.setFont("helvetica", "bold"); doc.setFontSize(10); doc.setTextColor(40, 20, 180)
    doc.text(footerTitleText, M, footerY)
    footerY += 14;

    doc.setFont("helvetica", "normal"); doc.setFontSize(8); doc.setTextColor(70, 68, 85)

    // Footer Sub Note (if available)
    if (settings.footerSubNote) {
        doc.text(settings.footerSubNote, M, footerY)
        footerY += 12;
    }

    // Help info (Support Email & Phone)
    const supportEmailVal = settings.supportEmail || "";
    const supportPhoneVal = settings.supportPhone || "";
    let helpText = "";
    if (supportEmailVal && supportPhoneVal) {
        helpText = `Need help? Email ${supportEmailVal} or call ${supportPhoneVal}`;
    } else if (supportEmailVal) {
        helpText = `Need help? Email ${supportEmailVal}`;
    } else if (supportPhoneVal) {
        helpText = `Need help? Call ${supportPhoneVal}`;
    }

    if (helpText) {
        doc.text(helpText, M, footerY)
        footerY += 12;
    }

    // UPI ID (if available)
    if (settings.upiId) {
        doc.text(`UPI ID: ${settings.upiId}`, M, footerY)
        footerY += 12;
    }

    // Computer generated disclaimer
    doc.setFontSize(7); doc.setTextColor(150, 150, 160)
    doc.text("This is a computer-generated invoice and does not require a signature.", M, footerY)

    /* ============================== SAVE ============================== */
    const filename = `Invoice_${fileSafe(rawId)}_${fileSafe(customerName)}.pdf`
    doc.save(filename)
}

export default generateInvoice