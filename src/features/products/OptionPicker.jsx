import React from "react"
import { getPurchaseOptions, isAvailable, formatINR, policySummary } from "./purchaseOptions"

// The "choose what to buy" control of the product page — one component for the mobile AND desktop layouts.
//
// The MAIN product is a chip of its own (when the admin sells it), next to one chip per active variant, each with
// its own image, price and availability. Selecting the main chip buys the main product at ITS price; selecting a
// variant chip buys that variant at ITS price — the two are never mixed, and nothing is added implicitly.
// (The old UI had no main chip: the main product was merely "nothing selected", and clicking the selected variant
// again silently switched back to it.)
//
//   product          mapProductRow() output
//   selectedVariant  the selected variant object from product.variants, or null for the main option
//   onSelect         (variantObjectOrNull) => void
//   layout           "mobile" | "desktop"  (only sizing differs)

export default function OptionPicker({ product, selectedVariant, onSelect, mainImage, layout = "desktop" }) {
    if (!product?.hasVariants) return null
    const options = getPurchaseOptions(product)
    if (options.length === 0 || !options.some((o) => o.kind === "variant")) return null

    const mobile = layout === "mobile"
    const selectedId = selectedVariant?.id != null ? String(selectedVariant.id) : ""
    const selected = options.find((o) => o.variantId === selectedId) || null

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: mobile ? "8px" : "10px", paddingTop: mobile ? "8px" : 0 }}>
            <p id={`opt-label-${layout}`} style={{ fontWeight: 600, fontSize: mobile ? "13px" : "14px", ...(mobile ? { letterSpacing: "0.6px", textTransform: "uppercase", color: "var(--color-muted)" } : { color: "var(--color-body)" }) }}>
                Choose an option
                {selected && <span style={{ fontWeight: 700, color: "var(--color-ink)", marginLeft: "6px", textTransform: "none", letterSpacing: 0 }}>— {selected.label}</span>}
            </p>

            <div role="radiogroup" aria-labelledby={`opt-label-${layout}`} style={{ display: "flex", flexWrap: "wrap", gap: mobile ? "8px" : "10px" }}>
                {options.map((o) => {
                    const isSelected = o.variantId === selectedId
                    const unavailable = !isAvailable(o)
                    const img = o.image || mainImage
                    return (
                        <button
                            key={o.key || "__main__"}
                            type="button" role="radio" aria-checked={isSelected} disabled={unavailable}
                            onClick={() => onSelect(o.variant)}
                            title={unavailable ? "Out of stock" : undefined}
                            style={{
                                padding: mobile ? "6px 14px" : "8px 18px", borderRadius: "9999px", fontSize: mobile ? "13px" : "14px", fontWeight: 600,
                                border: isSelected ? "2px solid var(--color-ink)" : `1px solid ${mobile ? "var(--color-border-strong)" : "var(--color-muted)"}`,
                                background: isSelected ? "var(--color-ink)" : (mobile ? "transparent" : "var(--color-background)"),
                                color: isSelected ? "var(--color-inverse)" : unavailable ? "var(--color-muted)" : "var(--color-ink)",
                                textDecoration: unavailable ? "line-through" : "none", cursor: unavailable ? "not-allowed" : "pointer", transition: "all 0.15s",
                            }}
                        >
                            <span style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                {img && (
                                    <img src={img} alt="" style={{ width: 44, height: 44, borderRadius: 6, objectFit: "cover", flexShrink: 0,
                                        border: isSelected ? "1px solid rgba(255,255,255,0.5)" : "1px solid var(--color-border)" }} />
                                )}
                                <span>{o.label} · {formatINR(o.price)}</span>
                            </span>
                        </button>
                    )
                })}
            </div>
        </div>
    )
}

/** SKU + return/exchange policy of the selected option — shown for single products too. */
export function OptionMeta({ product, selectedVariant }) {
    const options = getPurchaseOptions(product)
    const id = selectedVariant?.id != null ? String(selectedVariant.id) : ""
    const o = options.find((x) => x.variantId === id) || options[0]
    if (!o) return null
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "2px", fontSize: "12px", color: "var(--color-body)" }}>
            {o.sku ? <span>SKU: <strong style={{ color: "var(--color-ink)" }}>{o.sku}</strong></span> : null}
            <span>{policySummary(o)} <span style={{ color: "var(--color-muted)" }}>(from delivery)</span></span>
        </div>
    )
}