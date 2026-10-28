import React from "react"

// "Single Product" vs "Product with Variants" selector, plus — for a product with variants — the switch that
// decides whether the MAIN product is itself a purchasable option (at its own price/stock, independent of the
// variants). Shared by the Add and Edit pages.

const C = { indigo: "var(--color-error)", border: "var(--color-border)", textS: "var(--color-body)" }
const labelCls = "block text-[13px] font-semibold mb-1.5"

export default function ProductTypeSection({ productType, onTypeChange, mainOptionEnabled, onMainOptionChange, mainPrice, mainStock }) {
    return (
        <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${C.border}` }}>
            <label className={labelCls}>Product Type</label>
            <div className="flex gap-2 mt-1" role="radiogroup" aria-label="Product type">
                {[["single", "Single Product"], ["variant", "Product with Variants"]].map(([val, lbl]) => (
                    <button
                        key={val} type="button" role="radio" aria-checked={productType === val}
                        onClick={() => onTypeChange(val)}
                        className="flex-1 py-2.5 text-[13px] font-bold rounded-lg border transition-all"
                        style={{
                            background: productType === val ? C.indigo : "transparent",
                            color: productType === val ? "#fff" : C.textS,
                            borderColor: productType === val ? C.indigo : C.border,
                        }}>
                        {lbl}
                    </button>
                ))}
            </div>
            <p className="text-[12px] mt-1.5" style={{ color: C.textS }}>
                {productType === "single"
                    ? "One item with its own price and stock — no variants needed."
                    : "A main product plus variants (e.g. colours or sizes). The main product and every variant have their own price, SKU, stock and image — nothing is added up or averaged."}
            </p>

            {productType === "variant" && (
                <label className="flex items-start gap-3 mt-3 p-3 rounded-xl cursor-pointer"
                    style={{ border: `1px solid ${C.border}`, background: "var(--color-surface)" }}>
                    <input type="checkbox" className="mt-1" checked={mainOptionEnabled} onChange={(e) => onMainOptionChange(e.target.checked)} />
                    <span>
                        <span className="block text-[13px] font-semibold">Sell the main product as its own option</span>
                        <span className="block text-[12px]" style={{ color: C.textS }}>
                            {mainOptionEnabled
                                ? `Customers can buy the main product itself${mainPrice ? ` at ₹${mainPrice}` : ""}${mainStock !== "" && mainStock != null ? ` (${mainStock} in stock)` : ""} — separately from any variant.`
                                : "Off: customers must pick one of the variants. The main price and stock below are not used for sale."}
                        </span>
                    </span>
                </label>
            )}
        </div>
    )
}