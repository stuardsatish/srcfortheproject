import React, { useEffect, useState, useRef } from "react"
import { useParams, useNavigate } from "react-router-dom"
import { supabase } from "../../context/SupabaseConfig"
import { mapProductRow, mapVariantRows } from "../../utils/supabaseProducts"
import { validateImageFile, validateImageFiles } from "../../utils/uploadValidation"
import {
    ArrowLeft, UploadCloud, Save, CheckCircle2
} from "lucide-react"
import ProductTypeSection from "../../features/products/admin/ProductTypeSection"
import VariantManager from "../../features/products/admin/VariantManager"
import PolicyFields from "../../features/products/admin/PolicyFields"
import {
    POLICY_DEFAULTS, policyFromProduct, policyFromVariant, newVariantRow, validateProduct,
    buildProductPayload, buildVariantPayload, explainSaveError,
} from "../../features/products/admin/productForm"

/* ─── Design tokens (same as AddProductPage) ─── */
const C = {
    indigo: "var(--color-error)", indigoDark: "var(--color-primary)",
    greenBg: "var(--color-success-border)", greenText: "var(--color-success)", green: "var(--color-primary)",
    blueBg: "var(--color-info-subtle)", blueText: "var(--color-body)",
    redBg: "var(--color-error-subtle)", redText: "var(--color-error)", red: "var(--color-error)",
    surface: "var(--color-surface-muted)", border: "var(--color-border)", chip: "var(--color-surface-muted)",
    textP: "var(--color-ink)", textS: "var(--color-body)",
}
const GEIST = "'Geist', 'Inter', sans-serif"
const INTER = "'Inter', sans-serif"
const GST_RATES = ["0", "5", "12", "18", "28"]


const EMPTY_FORM = {
    title: "", category: "", price: "", stock: "", brand: "", sku: "",
    shortDescription: "", description: "", gstRate: "0", hsnCode: "",
    discount: "", discountExpiry: "", status: "active",
}

const EditProductPage = () => {
    const { id } = useParams()
    const navigate = useNavigate()

    /* ── Core state ── */
    const [form, setForm] = useState(EMPTY_FORM)
    const [fetching, setFetching] = useState(true)
    const [loading, setLoading] = useState(false)
    const [uploadProgress, setUploadProgress] = useState(0)
    const [saved, setSaved] = useState(false)

    /* ── Images ── */
    const [thumbFile, setThumbFile] = useState(null)
    const [thumbPreview, setThumbPreview] = useState("")
    const [existingGallery, setExistingGallery] = useState([])   // already-uploaded URLs
    const [newGalleryFiles, setNewGalleryFiles] = useState([])   // new files to upload
    const [newGalleryPreviews, setNewGalleryPreviews] = useState([])

    /* ── Variants (the editor itself is features/products/admin/VariantManager) ── */
    const [productType, setProductType] = useState("single")
    const [attributes, setAttributes] = useState([])
    const [variantRows, setVariantRows] = useState([])
    const [mainOptionEnabled, setMainOptionEnabled] = useState(true)
    const [trackInventory, setTrackInventory] = useState(true)
    const [tagsText, setTagsText] = useState("")
    const [policy, setPolicy] = useState({ ...POLICY_DEFAULTS })
    // What the admin SAW when the page opened. Sent back so the server can (a) refuse the save if someone else changed the
    // product meanwhile and (b) apply a stock edit as +/- on top of the CURRENT stock, never overwriting sales made meanwhile.
    const [loaded, setLoaded] = useState({ updatedAt: null, stock: null })
    const [schemaMissing, setSchemaMissing] = useState(false)   // migrations 20261014_01/02 not applied on this database

    const progressRef = useRef(null)

    /* ── Fetch product ── */
    useEffect(() => {
        const fetch = async () => {
            try {
                const { data: row, error } = await supabase.from("products").select("*").eq("id", id).maybeSingle()
                if (error) throw error
                if (!row) { navigate("/admin/add-product"); return }
                const p = mapProductRow(row)

                setForm({
                    title: p.title || "",
                    category: p.category || "",
                    price: p.price != null ? String(p.price) : "",
                    stock: p.stock != null ? String(p.stock) : "",
                    brand: p.brand || "",
                    sku: p.sku || "",
                    shortDescription: p.shortDescription || "",
                    description: p.description || "",
                    gstRate: p.gstRate != null ? String(p.gstRate) : "0",
                    hsnCode: p.hsnCode || "",
                    discount: p.discount != null ? String(p.discount) : "",
                    discountExpiry: p.discountExpiry || "",
                    status: p.status || "active",
                })
                setThumbPreview(p.thumbnail || p.image || "")
                setExistingGallery(p.gallery || [])
                setLoaded({ updatedAt: p.updatedAt, stock: p.stock })
                setMainOptionEnabled(p.mainOptionEnabled)
                setTrackInventory(p.trackInventory)
                setTagsText((p.tags || []).join(", "))
                setPolicy(policyFromProduct(p))

                setProductType(p.hasVariants ? "variant" : "single")
                setAttributes(p.attributes || [])

                // Variants come from the real table (the admin also sees INACTIVE ones). products.variants is only a cache.
                const { data: vRows, error: vErr } = await supabase.from("product_variants").select("*").eq("product_id", id).order("sort_order")
                if (vErr) {
                    setSchemaMissing(true)
                    setVariantRows((p.variants || []).map((v) => newVariantRow(v.id, {
                        name: v.name || "", price: v.price != null ? String(v.price) : "", stock: v.stock != null ? String(v.stock) : "",
                        sku: v.sku || "", imageUrl: v.image || "",
                    })))
                } else {
                    setVariantRows(mapVariantRows(vRows).map((v) => newVariantRow(v.id, {
                        name: v.name, price: String(v.price), stock: String(v.stock), sku: v.sku, imageUrl: v.image,
                        status: v.status, trackInventory: v.trackInventory, ...policyFromVariant(v), stockLoaded: v.stock,
                    })))
                }
            } catch (e) {
                console.error(e)
                alert("Failed to load product")
            } finally {
                setFetching(false)
            }
        }
        fetch()
    }, [id])

    /* ── Handlers ── */
    const onField = (e) => setForm((f) => ({ ...f, [e.target.name]: e.target.value }))

    const onThumb = (e) => {
        const file = e.target.files[0]
        if (!file) return
        const v = validateImageFile(file)
        if (!v.ok) { alert(v.error); e.target.value = ""; return }
        setThumbFile(file)
        setThumbPreview(URL.createObjectURL(file))
    }

    const onNewGallery = (e) => {
        const files = [...e.target.files]
        const v = validateImageFiles(files)
        if (!v.ok) { alert(v.error); e.target.value = ""; return }
        setNewGalleryFiles(files)
        setNewGalleryPreviews(files.map((f) => URL.createObjectURL(f)))
    }

    const removeExistingGalleryImg = async (url) => {
        if (!window.confirm("Remove this image from the gallery?")) return
        try {
            setLoading(true)
            const newGallery = existingGallery.filter((u) => u !== url)
            const { error } = await supabase.from("products").update({ gallery: newGallery }).eq("id", id)
            if (error) throw error
            // Best-effort storage delete
            try {
                const marker = "/storage/v1/object/public/products/"
                const idx = url.indexOf(marker)
                if (idx !== -1) await supabase.storage.from("products").remove([url.slice(idx + marker.length)])
            } catch (_) { }
            setExistingGallery(newGallery)
        } catch (e) {
            console.error(e); alert("Failed to remove image")
        } finally { setLoading(false) }
    }

    /* ── Save ── */
    const saveProduct = async () => {
        const problem = validateProduct({ form, productType, variantRows, mainOptionEnabled, policy, hasPrimaryImage: true, requireImage: false })
        if (problem) return alert(problem)
        if (schemaMissing) return alert("The database has not been migrated yet — apply migrations 20261014_01 and 20261014_02 first.")

        setLoading(true); setUploadProgress(5)
        try {
            const prodId = id
            const upload = async (path, file) => {
                const { error } = await supabase.storage.from("products").upload(path, file, { upsert: true })
                if (error) throw error
                return supabase.storage.from("products").getPublicUrl(path).data.publicUrl
            }

            // 1. Upload thumbnail if changed
            let thumbUrl = thumbPreview
            if (thumbFile) thumbUrl = await upload(`${prodId}/thumbnail/${thumbFile.name}`, thumbFile)
            setUploadProgress(20)

            // 2. Upload new gallery images
            const addedGalleryUrls = []
            for (let i = 0; i < newGalleryFiles.length; i++) {
                addedGalleryUrls.push(await upload(`${prodId}/gallery/${newGalleryFiles[i].name}`, newGalleryFiles[i]))
                setUploadProgress(20 + Math.round(((i + 1) / newGalleryFiles.length) * 40))
            }
            setUploadProgress(60)

            // 3. Upload per-variant images (a failed upload stops the save instead of silently dropping the image)
            const isVariant = productType === "variant"
            const variantsPayload = []
            for (const v of variantRows) {
                let vImgUrl = v.imageUrl || ""
                if (v.imageFile) vImgUrl = await upload(`${prodId}/variants/${v.id}/${v.imageFile.name}`, v.imageFile)
                variantsPayload.push(buildVariantPayload(v, { imageUrl: vImgUrl, attributes }))
            }
            setUploadProgress(90)

            // 4. ONE transactional, admin-checked, server-validated write. Stock edits travel as "+/- against what I saw".
            const { error: saveErr } = await supabase.rpc("save_product", {
                p_product: buildProductPayload({
                    id: prodId, form, status: form.status || "active", productType, mainOptionEnabled, trackInventory, policy, tagsText,
                    thumbnail: thumbUrl, gallery: [...existingGallery, ...addedGalleryUrls], attributes,
                    stockLoaded: loaded.stock, includeDiscount: true,
                }),
                p_variants: isVariant ? variantsPayload : [],
                p_expected_updated_at: loaded.updatedAt,
            })
            if (saveErr) throw saveErr

            setUploadProgress(100)
            setSaved(true)
            setTimeout(() => { setSaved(false); navigate("/admin/add-product") }, 1200)
        } catch (e) {
            // NB: uploads are NOT rolled back here — a re-uploaded image may share its path with the live one.
            console.error(e); alert(explainSaveError(e))
        } finally {
            setLoading(false)
        }
    }

    /* ── Style helpers ── */
    const inputCls = "w-full bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded-lg px-3 py-2.5 text-[15px] outline-none focus:ring-2 focus:ring-[var(--color-ring)]"
    const labelCls = "block text-[13px] font-semibold mb-1.5"

    /* ── Loading skeleton ── */
    if (fetching) {
        const bar = (s) => <div className="animate-pulse rounded-lg" style={{ background: "var(--color-surface-muted)", ...s }} />
        return (
            <div className="min-h-screen flex items-center justify-center px-6 py-12" style={{ background: C.surface, fontFamily: INTER }}>
                <div className="w-full max-w-3xl rounded-2xl p-8 shadow-sm" style={{ background: "var(--color-surface)", border: `1px solid ${C.border}` }}>
                    {bar({ height: 32, width: 200, marginBottom: 28 })}
                    <div className="grid grid-cols-2 gap-4 mb-6">{[...Array(6)].map((_, i) => <div key={i}>{bar({ height: 13, width: 90, marginBottom: 8 })}{bar({ height: 44 })}</div>)}</div>
                    {bar({ height: 120, marginBottom: 16 })}
                    {bar({ height: 48, marginTop: 24 })}
                </div>
            </div>
        )
    }

    return (
        <div className="min-h-screen px-4 sm:px-6 lg:px-10 pt-24 pb-12 sm:pt-8" style={{ background: C.surface, fontFamily: INTER, color: C.textP }}>
            <div className="max-w-4xl mx-auto">

                {/* Header */}
                <div className="flex items-center gap-3 mb-6">
                    <button onClick={() => navigate("/admin/add-product")}
                        className="flex items-center justify-center w-9 h-9 rounded-lg border transition-colors hover:bg-[var(--color-surface)]"
                        style={{ borderColor: C.border }}>
                        <ArrowLeft size={18} />
                    </button>
                    <div>
                        <p className="text-[11px] font-bold tracking-widest uppercase" style={{ color: C.textS }}>Admin / Product Management</p>
                        <h1 className="font-bold text-[22px] mt-0.5" style={{ fontFamily: GEIST }}>Edit Product</h1>
                    </div>
                </div>

                {/* Main card */}
                <div className="rounded-2xl p-6 shadow-sm" style={{ background: "var(--color-surface)", border: `1px solid ${C.border}` }}>

                    {schemaMissing && (
                        <div role="alert" className="mb-5 p-3 rounded-lg text-[13px] font-semibold" style={{ background: C.redBg, color: C.redText }}>
                            The database has not been migrated yet (the product_variants table / save_product function is missing), so this product cannot be saved.
                            Apply migrations 20261014_01 and 20261014_02 first.
                        </div>
                    )}
                    {/* Status toggle */}
                    <div className="flex items-center justify-between mb-6 pb-5" style={{ borderBottom: `1px solid ${C.border}` }}>
                        <h2 className="font-bold text-[17px]" style={{ fontFamily: GEIST }}>Product Details</h2>
                        <button type="button" onClick={() => setForm((f) => ({ ...f, status: f.status === "active" ? "draft" : "active" }))}
                            className="flex items-center gap-2">
                            <span className="text-[13px] font-semibold" style={{ color: C.textS }}>Status</span>
                            <span className="relative inline-flex items-center rounded-full transition-colors"
                                style={{ width: 44, height: 24, background: form.status === "active" ? C.green : "var(--color-border-strong)" }}>
                                <span className="absolute bg-surface rounded-full transition-all"
                                    style={{ width: 18, height: 18, top: 3, left: form.status === "active" ? 23 : 3 }} />
                            </span>
                            <span className="text-[13px] font-bold w-11" style={{ color: form.status === "active" ? C.green : C.textS }}>
                                {form.status === "active" ? "Active" : "Draft"}
                            </span>
                        </button>
                    </div>

                    {/* Fields grid */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="md:col-span-2">
                            <label className={labelCls}>Product Name</label>
                            <input name="title" value={form.title} onChange={onField} placeholder="e.g. Kaju Katli" className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>Category</label>
                            <input name="category" value={form.category} onChange={onField} placeholder="e.g. Sweets" className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>Brand</label>
                            <input name="brand" value={form.brand} onChange={onField} placeholder="e.g. Haldiram" className={inputCls} />
                        </div>

                        {/* Price */}
                        <div>
                            <label className={labelCls}>
                                Price (₹)
                            </label>
                            <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[15px]" style={{ color: C.textS }}>₹</span>
                                <input name="price" type="number" value={form.price} onChange={onField} placeholder="0.00" className={`${inputCls} pl-7`} />
                            </div>
                        </div>

                        {/* Stock */}
                        <div>
                            <label className={labelCls}>
                                Stock Quantity
                            </label>
                            <input name="stock" type="number" value={form.stock} onChange={onField} placeholder="0" className={inputCls} />
                        </div>

                        <div>
                            <label className={labelCls}>SKU</label>
                            <input name="sku" value={form.sku} onChange={onField} placeholder="APX-001" className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>GST Rate (%)</label>
                            <select name="gstRate" value={form.gstRate} onChange={onField} className={inputCls}>
                                {GST_RATES.map((r) => <option key={r} value={r}>{r === "0" ? "0% (Exempt)" : `${r}%`}</option>)}
                            </select>
                        </div>
                        <div>
                            <label className={labelCls}>HSN Code</label>
                            <input name="hsnCode" value={form.hsnCode} onChange={onField} placeholder="e.g. 0207" className={inputCls} />
                        </div>
                        <div>
                            <label className={labelCls}>Discount (%)</label>
                            <input name="discount" type="number" value={form.discount} onChange={onField} placeholder="0" className={inputCls} />
                        </div>
                        <div className="md:col-span-2">
                            <label className={labelCls}>Discount Expiry Date & Time</label>
                            <input name="discountExpiry" type="datetime-local" value={form.discountExpiry || ""} onChange={onField} className={inputCls} />
                        </div>
                        <div className="md:col-span-2">
                            <label className={labelCls}>Short Description</label>
                            <input name="shortDescription" value={form.shortDescription} onChange={onField} placeholder="Brief product summary…" className={inputCls} />
                        </div>
                        <div className="md:col-span-2">
                            <label className={labelCls}>Full Description</label>
                            <textarea name="description" value={form.description} onChange={onField} rows={4} placeholder="Detailed product description…" className={`${inputCls} resize-y`} />
                        </div>
                        <div className="md:col-span-2">
                            <label className={labelCls}>Tags</label>
                            <input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="Comma-separated, e.g. cotton, summer, gift" className={inputCls} />
                            <p className="text-[11px] mt-1" style={{ color: C.textS }}>For search and filtering. Saved in lower case.</p>
                        </div>
                        <label className="md:col-span-2 flex items-center gap-2 text-[13px] font-semibold">
                            <input type="checkbox" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)} />
                            Track stock for this product <span className="font-normal" style={{ color: C.textS }}>(turn off for items that are always available)</span>
                        </label>
                        <div className="md:col-span-2">
                            <label className={labelCls}>Returns &amp; exchanges</label>
                            <PolicyFields idPrefix="product-policy" value={policy} onChange={setPolicy} />
                            <p className="text-[11px] mt-1" style={{ color: C.textS }}>Applies to orders placed from now on. Existing orders keep the policy they were bought under.</p>
                        </div>
                    </div>

                    {/* ── MEDIA ── */}
                    <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${C.border}` }}>
                        <h3 className="font-bold text-[15px] mb-4">Images</h3>
                        <div className="grid grid-cols-1 md:grid-cols-[180px_1fr] gap-4">
                            {/* Thumbnail */}
                            <div>
                                <label className={labelCls}>Primary Image</label>
                                <label className="flex flex-col items-center justify-center text-center cursor-pointer border border-dashed rounded-xl overflow-hidden"
                                    style={{ borderColor: C.border, height: 150, background: thumbPreview ? "transparent" : "var(--color-surface)" }}>
                                    {thumbPreview
                                        ? <img src={thumbPreview} alt="" className="w-full h-full object-cover" />
                                        : <span className="flex flex-col items-center gap-2 px-3" style={{ color: C.textS }}>
                                            <UploadCloud size={24} /><span className="text-[12px]">Click to upload thumbnail</span>
                                          </span>}
                                    <input type="file" accept="image/*" className="hidden" onChange={onThumb} />
                                </label>
                                {thumbPreview && (
                                    <button type="button" onClick={() => { setThumbFile(null); setThumbPreview("") }}
                                        className="text-[11px] mt-1" style={{ color: C.redText }}>Remove thumbnail</button>
                                )}
                            </div>

                            {/* Gallery */}
                            <div>
                                <label className={labelCls}>Gallery Images</label>

                                {/* Existing gallery */}
                                {existingGallery.length > 0 && (
                                    <div className="flex gap-2 flex-wrap mb-3">
                                        {existingGallery.map((url, i) => (
                                            <div key={i} className="relative flex-shrink-0"
                                                style={{ width: 72, height: 72, borderRadius: 8, overflow: "hidden", border: `1px solid ${C.border}` }}>
                                                <img src={url} alt="" className="w-full h-full object-cover" />
                                                <button type="button" onClick={() => removeExistingGalleryImg(url)}
                                                    className="absolute top-0.5 right-0.5 flex items-center justify-center rounded-full text-[10px] font-bold"
                                                    style={{ width: 18, height: 18, background: "var(--color-error)", color: "#fff" }}>✕</button>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Add new gallery images */}
                                <label className="inline-flex items-center gap-2 cursor-pointer px-4 py-2 rounded-lg text-[13px] font-bold mb-2"
                                    style={{ background: C.chip, border: `1px dashed ${C.border}`, color: C.textS }}>
                                    <UploadCloud size={16} />
                                    {newGalleryPreviews.length > 0 ? `${newGalleryPreviews.length} new image(s) selected` : "Add gallery images"}
                                    <input type="file" accept="image/*" multiple className="hidden" onChange={onNewGallery} />
                                </label>
                                {newGalleryPreviews.length > 0 && (
                                    <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: "thin" }}>
                                        {newGalleryPreviews.map((src, i) => (
                                            <div key={i} className="flex-shrink-0 overflow-hidden"
                                                style={{ width: 64, height: 64, borderRadius: 8, border: `1px solid ${C.border}` }}>
                                                <img src={src} alt="" className="w-full h-full object-cover" />
                                            </div>
                                        ))}
                                    </div>
                                )}

                                {/* Progress bar */}
                                {loading && uploadProgress > 0 && uploadProgress < 100 && (
                                    <div className="mt-2 rounded-full overflow-hidden" style={{ height: 6, background: C.chip }}>
                                        <div style={{ height: "100%", width: `${uploadProgress}%`, background: C.indigo, borderRadius: 9999, transition: "width 0.3s" }} />
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* ── PRODUCT TYPE + VARIANTS ── */}
                    <ProductTypeSection
                        productType={productType}
                        onTypeChange={setProductType}
                        mainOptionEnabled={mainOptionEnabled}
                        onMainOptionChange={setMainOptionEnabled}
                        mainPrice={form.price}
                        mainStock={form.stock}
                    />
                    {productType === "variant" && (
                        <VariantManager mode="edit" attributes={attributes} setAttributes={setAttributes} variantRows={variantRows} setVariantRows={setVariantRows} />
                    )}

                    {/* ── ACTION BUTTONS ── */}
                    <div className="flex flex-col sm:flex-row gap-3 mt-8 pt-6" style={{ borderTop: `1px solid ${C.border}` }}>
                        <button type="button" onClick={saveProduct} disabled={loading || schemaMissing}
                            className="flex items-center justify-center gap-2 flex-1 py-3 rounded-xl text-[15px] font-bold transition-all"
                            style={{
                                background: saved ? "var(--color-success)" : "var(--color-ink)",
                                color: "var(--color-inverse)",
                                opacity: loading ? 0.7 : 1,
                            }}>
                            {saved ? <><CheckCircle2 size={18} /> Saved!</> : loading ? `Saving… ${uploadProgress > 0 ? `${Math.round(uploadProgress)}%` : ""}` : <><Save size={18} /> Save Changes</>}
                        </button>
                        <button type="button" onClick={() => navigate("/admin/add-product")} disabled={loading}
                            className="flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-[15px] font-bold border transition-colors"
                            style={{ borderColor: C.border, color: C.textS }}>
                            <ArrowLeft size={16} /> Cancel
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default EditProductPage