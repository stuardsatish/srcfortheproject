import React, { useState } from "react"
import { Plus, Trash2, UploadCloud, Image as ImageIcon } from "lucide-react"
import { validateImageFile } from "../../../utils/uploadValidation"
import { newVariantRow, rebuildVariantRows, POLICY_DEFAULTS } from "./productForm"
import PolicyFields from "./PolicyFields"

// Variant editor shared by AddProductPage and EditProductPage (they used to carry two near-identical copies).
//
// State stays in the page (it needs it to save): attributes + variantRows. This component owns only its own UI state.
// Behaviour kept from the old inline code: attribute generator (cartesian product), manual add, expandable cards,
// per-variant image. Behaviour CHANGED on purpose:
//   * regenerating from attributes no longer silently drops variants that do not match a generated combination
//     (they may carry stock, sales history and a custom price) — they are kept; remove them with the bin icon;
//   * every variant can be switched off (status) and can override the product's return/exchange policy.

const C = {
    indigo: "var(--color-error)", border: "var(--color-border)", chip: "var(--color-surface-muted)",
    blueBg: "var(--color-info-subtle)", blueText: "var(--color-body)", redText: "var(--color-error)",
    textP: "var(--color-ink)", textS: "var(--color-body)",
}
const inputCls = "w-full bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
const smallLabel = "text-[11px] font-semibold mb-1 block"

export default function VariantManager({ attributes, setAttributes, variantRows, setVariantRows, mode = "add" }) {
    const [editingId, setEditingId] = useState(null)
    const [attrName, setAttrName] = useState("")
    const [attrOptions, setAttrOptions] = useState("")
    const [draft, setDraft] = useState({ name: "", price: "", stock: "", sku: "" })

    const patchRow = (i, patch) => setVariantRows((rows) => rows.map((x, j) => (j === i ? { ...x, ...patch } : x)))

    const generate = () => {
        if (!attrName.trim()) return
        const opts = attrOptions.split(",").map((s) => s.trim()).filter(Boolean)
        if (!opts.length) return
        const updated = [...attributes.filter((a) => a.name !== attrName.trim()), { name: attrName.trim(), options: opts }]
        setAttributes(updated)
        setVariantRows(rebuildVariantRows(updated, variantRows))
        setAttrName(""); setAttrOptions("")
    }

    const addManual = () => {
        if (!draft.name.trim() || !draft.price) return
        if (variantRows.some((v) => v.name.trim().toLowerCase() === draft.name.trim().toLowerCase())) {
            return alert("A variant with this name already exists.")
        }
        setVariantRows((r) => [...r, newVariantRow(`var_${Date.now()}`, {
            name: draft.name.trim(), price: draft.price, stock: draft.stock || "0", sku: draft.sku || "",
        })])
        setDraft({ name: "", price: "", stock: "", sku: "" })
    }

    const onVariantImage = (i, file) => {
        if (!file) return
        const v = validateImageFile(file)
        if (!v.ok) return alert(v.error)      // variant images were never size/type-checked before
        patchRow(i, { imageFile: file, imagePreview: URL.createObjectURL(file) })
    }

    return (
        <div className="mt-4 rounded-xl p-4" style={{ border: `1px solid ${C.border}`, background: "var(--color-surface-muted)" }}>
            <div className="flex items-center justify-between mb-4">
                <h3 className="font-bold text-[15px]">Variants</h3>
                <span className="text-[12px] font-semibold px-2.5 py-1 rounded-full" style={{ background: C.blueBg, color: C.blueText }}>
                    {variantRows.length} variant{variantRows.length !== 1 ? "s" : ""}
                </span>
            </div>

            {/* Step 1: generate from attributes */}
            <div className="mb-4 p-4 rounded-xl" style={{ background: "var(--color-surface)", border: `1px solid ${C.border}` }}>
                <p className="text-[12px] font-bold uppercase tracking-wider mb-1" style={{ color: C.textS }}>Generate variants from attributes</p>
                <p className="text-[11px] mb-3" style={{ color: C.textS }}>e.g. Attribute “Color” → Options “Pink, White, Violet”. Existing variants are kept; only missing combinations are added.</p>
                <div className="flex gap-2 flex-wrap">
                    <input value={attrName} onChange={(e) => setAttrName(e.target.value)} placeholder="Attribute name (e.g. Color)"
                        className={inputCls} style={{ flex: 1, minWidth: 130 }} aria-label="Attribute name" />
                    <input value={attrOptions} onChange={(e) => setAttrOptions(e.target.value)} placeholder="Options, comma-separated (e.g. Pink, White)"
                        className={inputCls} style={{ flex: 2, minWidth: 200 }} aria-label="Attribute options" />
                    <button type="button" onClick={generate} className="px-4 py-2.5 text-[13px] font-bold text-white rounded-lg whitespace-nowrap" style={{ background: C.indigo }}>Generate</button>
                </div>
                {attributes.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-3">
                        {attributes.map((a, i) => (
                            <span key={i} className="flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold" style={{ background: C.blueBg, color: C.blueText }}>
                                {a.name}: {a.options.join(", ")}
                                <button type="button" aria-label={`Remove attribute ${a.name}`} className="ml-1" style={{ color: C.redText }}
                                    onClick={() => setAttributes(attributes.filter((_, j) => j !== i))}>✕</button>
                            </span>
                        ))}
                    </div>
                )}
            </div>

            {/* Step 2: add one manually */}
            <div className="mb-4 p-4 rounded-xl" style={{ background: "var(--color-surface)", border: `1px solid ${C.border}` }}>
                <p className="text-[12px] font-bold uppercase tracking-wider mb-3" style={{ color: C.textS }}>Or add a variant manually</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    {[["name", "Variant name *", "e.g. Pink", "text"], ["price", "Price (₹) *", "0.00", "number"], ["stock", "Stock", "0", "number"], ["sku", "SKU", "Optional", "text"]].map(([key, lbl, ph, type]) => (
                        <div key={key}>
                            <label className={smallLabel} style={{ color: C.textS }}>{lbl}</label>
                            <input type={type} value={draft[key]} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} placeholder={ph} className={inputCls} />
                        </div>
                    ))}
                </div>
                <button type="button" onClick={addManual} className="mt-3 flex items-center gap-2 px-4 py-2 text-[13px] font-bold rounded-lg"
                    style={{ background: "var(--color-ink)", color: "var(--color-inverse)" }}>
                    <Plus size={14} /> Add variant
                </button>
            </div>

            {/* Step 3: cards */}
            {variantRows.length > 0 ? (
                <div>
                    <p className="text-[12px] font-bold uppercase tracking-wider mb-3" style={{ color: C.textS }}>
                        Variants ({variantRows.length}) — click a card to edit
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {variantRows.map((v, i) => {
                            const isEditing = editingId === v.id
                            const imgSrc = v.imagePreview || v.imageUrl || null
                            const off = v.status === "inactive"
                            return (
                                <div key={v.id} className="rounded-xl overflow-hidden"
                                    style={{ border: isEditing ? "2px solid var(--color-ink)" : `1px solid ${C.border}`, background: "var(--color-surface)", opacity: off ? 0.7 : 1, transition: "border 0.15s" }}>
                                    <div className="flex items-center gap-3 p-3 cursor-pointer" onClick={() => setEditingId(isEditing ? null : v.id)}>
                                        <div className="flex-shrink-0 flex items-center justify-center overflow-hidden"
                                            style={{ width: 48, height: 48, borderRadius: 8, background: C.chip, border: `1px dashed ${C.border}` }}>
                                            {imgSrc ? <img src={imgSrc} alt="" className="w-full h-full object-cover" style={{ borderRadius: 8 }} /> : <ImageIcon size={18} style={{ color: "var(--color-muted)" }} />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-[14px] font-bold truncate" style={{ color: C.textP }}>
                                                {v.name || <span style={{ color: C.redText }}>No name</span>}
                                                {off && <span className="ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded" style={{ background: C.chip, color: C.textS }}>INACTIVE</span>}
                                            </p>
                                            <p className="text-[12px]" style={{ color: C.textS }}>
                                                {v.price ? `₹${v.price}` : <span style={{ color: C.redText }}>No price</span>}
                                                {v.trackInventory === false ? " · not tracked" : (v.stock ? ` · ${v.stock} in stock` : " · stock 0")}
                                                {v.sku ? ` · ${v.sku}` : ""}
                                                {v.policyMode === "custom" ? " · custom returns" : ""}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <span className="text-[11px] font-bold px-2 py-1 rounded"
                                                style={{ background: isEditing ? "var(--color-ink)" : C.chip, color: isEditing ? "var(--color-inverse)" : C.textS }}>
                                                {isEditing ? "▲ Close" : "✎ Edit"}
                                            </span>
                                            <button type="button" aria-label={`Delete variant ${v.name}`} className="p-1 rounded" style={{ color: C.redText }}
                                                onClick={(e) => {
                                                    e.stopPropagation()
                                                    if (mode === "edit" && v.stockLoaded != null && !window.confirm(`Delete the variant “${v.name}”? Past orders keep their details; the variant disappears from the shop.`)) return
                                                    setVariantRows((r) => r.filter((_, j) => j !== i))
                                                    if (isEditing) setEditingId(null)
                                                }}>
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>

                                    {isEditing && (
                                        <div className="px-3 pb-4 pt-1" style={{ borderTop: `1px solid ${C.border}`, background: "var(--color-surface-muted)" }}>
                                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3">
                                                {[["name", "Variant name *", "text"], ["price", "Price (₹) *", "number"], ["stock", "Stock", "number"], ["sku", "SKU (optional)", "text"]].map(([key, lbl, type]) => (
                                                    <div key={key}>
                                                        <label className={smallLabel} style={{ color: C.textS }}>{lbl}</label>
                                                        <input type={type} value={v[key]} onChange={(e) => patchRow(i, { [key]: e.target.value })} className={inputCls}
                                                            disabled={key === "stock" && v.trackInventory === false} />
                                                    </div>
                                                ))}

                                                <div>
                                                    <label className={smallLabel} style={{ color: C.textS }}>Status</label>
                                                    <select value={v.status} onChange={(e) => patchRow(i, { status: e.target.value })} className={inputCls}>
                                                        <option value="active">Active (visible &amp; purchasable)</option>
                                                        <option value="inactive">Inactive (hidden from customers)</option>
                                                    </select>
                                                </div>
                                                <label className="flex items-center gap-2 text-[13px] font-semibold self-end pb-2.5">
                                                    <input type="checkbox" checked={v.trackInventory !== false} onChange={(e) => patchRow(i, { trackInventory: e.target.checked })} />
                                                    Track stock for this variant
                                                </label>

                                                {mode === "edit" && v.stockLoaded != null && (
                                                    <p className="sm:col-span-3 text-[11px]" style={{ color: C.textS }}>
                                                        Stock when you opened this page: <strong>{v.stockLoaded}</strong>. Your change is applied as + / − on top of the current stock, so sales made meanwhile are never overwritten.
                                                    </p>
                                                )}

                                                {/* Image */}
                                                <div className="sm:col-span-2">
                                                    <label className={smallLabel} style={{ color: C.textS }}>Variant image (optional)</label>
                                                    <label className="flex items-center gap-3 cursor-pointer rounded-xl overflow-hidden p-2"
                                                        style={{ border: `1px dashed ${C.border}`, background: "var(--color-surface)", minHeight: 64 }}>
                                                        {imgSrc ? <img src={imgSrc} alt="" className="flex-shrink-0 object-cover rounded-lg" style={{ width: 56, height: 56 }} />
                                                            : <div className="flex-shrink-0 flex items-center justify-center rounded-lg" style={{ width: 56, height: 56, background: C.chip }}><UploadCloud size={20} style={{ color: "var(--color-muted)" }} /></div>}
                                                        <div>
                                                            <p className="text-[12px] font-semibold" style={{ color: C.textP }}>Click to upload image</p>
                                                            <p className="text-[11px]" style={{ color: C.textS }}>JPG, PNG, WEBP · max 5 MB</p>
                                                        </div>
                                                        <input type="file" accept="image/*" className="hidden" onChange={(e) => onVariantImage(i, e.target.files[0])} />
                                                    </label>
                                                    {imgSrc && (
                                                        <button type="button" onClick={() => patchRow(i, { imageFile: null, imagePreview: "", imageUrl: "" })}
                                                            className="text-[11px] mt-1" style={{ color: C.redText }}>Remove image</button>
                                                    )}
                                                </div>

                                                {/* Policy override */}
                                                <div className="sm:col-span-3">
                                                    <label className={smallLabel} style={{ color: C.textS }}>Returns &amp; exchanges for this variant</label>
                                                    <div className="flex gap-4 mb-2">
                                                        {[["inherit", "Same as the product"], ["custom", "Custom for this variant"]].map(([val, lbl]) => (
                                                            <label key={val} className="flex items-center gap-2 text-[13px]">
                                                                <input type="radio" name={`policyMode-${v.id}`} checked={v.policyMode === val}
                                                                    onChange={() => patchRow(i, { policyMode: val, policy: v.policy || { ...POLICY_DEFAULTS } })} />
                                                                {lbl}
                                                            </label>
                                                        ))}
                                                    </div>
                                                    {v.policyMode === "custom" && (
                                                        <PolicyFields idPrefix={`pol-${v.id}`} value={v.policy} onChange={(policy) => patchRow(i, { policy })} />
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                    <p className="text-[11px] mt-3" style={{ color: C.textS }}>
                        Each variant is sold at its own price from its own stock. The main product keeps its own price and stock (set above) — it is never calculated from the variants.
                    </p>
                </div>
            ) : (
                <div className="text-center py-8 rounded-xl" style={{ border: `1px dashed ${C.border}` }}>
                    <p className="text-[14px] font-semibold" style={{ color: C.textS }}>No variants yet</p>
                    <p className="text-[12px] mt-1" style={{ color: C.textS }}>Generate them from attributes above, or add one manually.</p>
                </div>
            )}
        </div>
    )
}