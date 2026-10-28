import React, { useEffect, useState, useRef, useMemo } from "react"
import Papa from "papaparse"
import { supabase } from "../../context/SupabaseConfig"
import { mapProductRows } from "../../utils/supabaseProducts"
import { validateImageFile, validateImageFiles } from "../../utils/uploadValidation"
import { useNavigate } from "react-router-dom"
import gsap from "gsap"
import {
    Download, Plus, Search, Filter, LayoutGrid, List as ListIcon,
    Eye, Pencil, Trash2, UploadCloud, ChevronLeft, ChevronRight, Image as ImageIcon,
    AlertTriangle, Package, Check, X, Tag, Layers, RefreshCw, FileSpreadsheet,
    Moon, Bell, ChevronDown, SlidersHorizontal, ArrowUpDown,
} from "lucide-react"
import { PRODUCT_IMPORT_HEADERS, PRODUCT_IMPORT_SAMPLE_ROW } from "../../constants/productImportHeaders"
import RightDrawer from "../../components/Common/RightDrawer"
import ProductTypeSection from "../../features/products/admin/ProductTypeSection"
import VariantManager from "../../features/products/admin/VariantManager"
import PolicyFields from "../../features/products/admin/PolicyFields"
import BulkProductImport from "../../features/bulkImport/BulkProductImport"
import Pagination from "../../components/Pagination"
import {
    POLICY_DEFAULTS, policyFromSettings, policyForCategory, categoryListsFromSettings, validateProduct, buildProductPayload, buildVariantPayload, explainSaveError,
} from "../../features/products/admin/productForm"

/* ============================== PELAGO DESIGN TOKENS ============================== */
const FONT = "'Plus Jakarta Sans', 'Inter', sans-serif"
const MONO = "'JetBrains Mono', monospace"

const TEAL = "#104945"
const TEAL_DARK = "#0C3936"
const TEAL_LIGHT = "#DEEEE7"
const TEAL_SUBTLE = "#E6F3F1"
const BORDER = "#E2DBD0"
const CANVAS = "#EDE8E1"
const WHITE = "#FFFFFF"
const CARD_BG = "#FFFFFF"
const INK = "#171412"
const MUTED = "#78716C"
const MUTED_LIGHT = "#8C8478"
const GREEN = "#167448"
const RED = "#BE413B"
const AMBER = "#D99726"

const PAGE_SIZE = 28
const EMPTY_FORM = { title: "", category: "", price: "", stock: "", brand: "", sku: "", shortDescription: "", description: "", gstRate: "0", hsnCode: "" }
const GST_RATES = ["0", "5", "12", "18", "28"]

const CATEGORY_ICONS = {
    mugs: "☕", mug: "☕", cups: "☕", cup: "☕",
    plates: "🍽", plate: "🍽", bowls: "🍽", bowl: "🍽",
    vases: "🏺", vase: "🏺",
    planters: "🪴", planter: "🪴", pots: "🪴",
    teaware: "🫖", tea: "🫖",
    linen: "🪡", cloth: "🪡",
    sweets: "🍬", sweet: "🍬", groceries: "🍎", food: "🥗",
    shirts: "👕", shirt: "👕", apparel: "👕", clothes: "👕",
}
const getCategoryIcon = (cat) => {
    if (!cat) return "📦"
    const k = cat.toLowerCase().trim()
    return CATEGORY_ICONS[k] || "💧"
}

const CERAMIC_GRADIENTS = [
    "from-[#214F4B] to-[#123632]",
    "from-[#6A7873] to-[#45504C]",
    "from-[#567562] to-[#3B5445]",
    "from-[#1C4E51] to-[#123639]",
    "from-[#CCC5B6] to-[#A39B8C]",
    "from-[#4A241C] to-[#2B140F]",
    "from-[#677F6A] to-[#455D49]",
]

const SORT_OPTIONS = [
    { key: "bestselling", label: "Best selling" },
    { key: "price_asc", label: "Price: Low to High" },
    { key: "price_desc", label: "Price: High to Low" },
    { key: "newest", label: "Newest arrivals" },
    { key: "name_asc", label: "Alphabetical (A-Z)" },
]

const DATE_RANGES = [
    { key: "today", label: "Today" },
    { key: "7d", label: "Last 7 Days" },
    { key: "30d", label: "Last 30 Days" },
    { key: "90d", label: "Last 90 Days" },
    { key: "6m", label: "Last 6 Months" },
    { key: "all", label: "All Time" },
    { key: "custom", label: "Custom" },
]

const toMillis = (v) => {
    if (!v) return 0
    if (v?.toDate) return v.toDate().getTime()
    const d = new Date(v)
    return isNaN(d.getTime()) ? 0 : d.getTime()
}
const money = (n) => `₹${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`

const AddProductPage = ({
    activeTab = "catalog",
    onSwitchTab,
    showHeader = true,
    onStatsChange,
    actionsRef,
    dateRange: propDateRange,
}) => {
    const navigate = useNavigate()

    /* -------- product catalog state -------- */
    const [products, setProducts] = useState([])
    const [loading, setLoading] = useState(false)
    const [catalogLoading, setCatalogLoading] = useState(true)
    const [uploadProgress, setUploadProgress] = useState(0)

    /* -------- form toggle -------- */
    const [showAddForm, setShowAddForm] = useState(false)
    const [showCsvImport, setShowCsvImport] = useState(false)

    /* -------- add-product form -------- */
    const [form, setForm] = useState(EMPTY_FORM)
    const [status, setStatus] = useState("active")
    const [addingCategory, setAddingCategory] = useState(false)
    const [thumbFile, setThumbFile] = useState(null)
    const [thumbPreview, setThumbPreview] = useState("")
    const [galleryFiles, setGalleryFiles] = useState([])
    const [galleryPreviews, setGalleryPreviews] = useState([])

    /* -------- variant / combination product -------- */
    const [productType, setProductType] = useState("single")
    const [attributes, setAttributes] = useState([])
    const [variantRows, setVariantRows] = useState([])
    const [mainOptionEnabled, setMainOptionEnabled] = useState(true)
    const [trackInventory, setTrackInventory] = useState(true)
    const [tagsText, setTagsText] = useState("")
    const [storePolicy, setStorePolicy] = useState({ ...POLICY_DEFAULTS })
    const [categoryLists, setCategoryLists] = useState({ noReturnCategories: [], noExchangeCategories: [] })
    const policyTouched = useRef(false)
    const [policy, setPolicy] = useState({ ...POLICY_DEFAULTS })

    /* -------- CSV bulk import -------- */
    const [bulkOpen, setBulkOpen] = useState(false)
    const [csvName, setCsvName] = useState("")
    const [csvRows, setCsvRows] = useState([])

    /* -------- catalog table / filter -------- */
    const [search, setSearch] = useState("")
    const [viewMode, setViewMode] = useState("grid")
    const [page, setPage] = useState(1)
    const [showFilters, setShowFilters] = useState(false)
    const [categoryFilter, setCategoryFilter] = useState("all")
    const [statusFilter, setStatusFilter] = useState("all")
    const [dateRange, setDateRange] = useState("all")

    useEffect(() => {
        if (propDateRange !== undefined && propDateRange !== null) {
            setDateRange(propDateRange)
        }
    }, [propDateRange])
    const [collectionFilter, setCollectionFilter] = useState("all")
    const [showCollectionsDropdown, setShowCollectionsDropdown] = useState(false)
    const [sortBy, setSortBy] = useState("bestselling")
    const [showSortDropdown, setShowSortDropdown] = useState(false)

    /* -------- drawer -------- */
    const [selected, setSelected] = useState(null)
    const [displayedProduct, setDisplayedProduct] = useState(null)
    const [drawerImg, setDrawerImg] = useState(0)

    const rootRef = useRef(null)
    const formSectionRef = useRef(null)

    /* ===============================================================
       REALTIME PRODUCTS
    =============================================================== */
    useEffect(() => {
        const fetchProducts = async () => {
            const { data, error } = await supabase.from("products").select("*")
            if (error) { console.error("Error loading products:", error); setCatalogLoading(false); return }
            const arr = mapProductRows(data)
            arr.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
            setProducts(arr)
            setCatalogLoading(false)
        }
        fetchProducts()
        const channel = supabase
            .channel("admin-products-list")
            .on("postgres_changes", { event: "*", schema: "public", table: "products" }, fetchProducts)
            .subscribe()
        return () => supabase.removeChannel(channel)
    }, [])

    /* ===============================================================
       DERIVED
    =============================================================== */
    const categories = useMemo(() => [...new Set(products.map((p) => p.category).filter(Boolean))], [products])

    const stats = useMemo(() => {
        const total = products.length
        const activeCategories = categories.length
        const lowStock = products.filter((p) => Number(p.stock) < 10 && Number(p.stock) > 0).length
        const outStock = products.filter((p) => Number(p.stock) === 0).length
        const now = new Date()
        const addedThisMonth = products.filter((p) => {
            const d = toMillis(p.createdAt)
            if (!d) return false
            const dt = new Date(d)
            return dt.getMonth() === now.getMonth() && dt.getFullYear() === now.getFullYear()
        }).length
        const totalStockValue = products.reduce((acc, p) => acc + (Number(p.price || 0) * Number(p.stock || 0)), 0)
        return { total, activeCategories, lowStock, outStock, addedThisMonth, totalStockValue }
    }, [products, categories])

    useEffect(() => {
        if (onStatsChange) onStatsChange({ ...stats, showAddForm })
    }, [stats, showAddForm, onStatsChange])

    const toggleProductStatus = async (product) => {
        const nextStatus = product.status === "draft" ? "active" : "draft"
        try {
            const { error } = await supabase.from("products").update({ status: nextStatus }).eq("id", product.id)
            if (error) throw error
            setProducts((prev) => prev.map((p) => p.id === product.id ? { ...p, status: nextStatus } : p))
        } catch (err) {
            console.error("Failed to toggle status:", err)
        }
    }

    const filtered = useMemo(() => {
        const q = search.toLowerCase().trim()
        let list = products.filter((p) => {
            const matchSearch = !q || p.title?.toLowerCase().includes(q) || p.sku?.toLowerCase().includes(q) || p.category?.toLowerCase().includes(q)
            const matchCat = categoryFilter === "all" || p.category?.toLowerCase() === categoryFilter.toLowerCase()
            const matchColl = collectionFilter === "all" || p.category?.toLowerCase() === collectionFilter.toLowerCase() || p.brand?.toLowerCase() === collectionFilter.toLowerCase()
            const pSt = p.status === "draft" ? "draft" : "active"
            const matchSt = statusFilter === "all" || pSt === statusFilter
            return matchSearch && matchCat && matchColl && matchSt
        })

        if (sortBy === "price_asc") {
            list.sort((a, b) => Number(a.price || 0) - Number(b.price || 0))
        } else if (sortBy === "price_desc") {
            list.sort((a, b) => Number(b.price || 0) - Number(a.price || 0))
        } else if (sortBy === "newest") {
            list.sort((a, b) => toMillis(b.createdAt) - toMillis(a.createdAt))
        } else if (sortBy === "name_asc") {
            list.sort((a, b) => (a.title || "").localeCompare(b.title || ""))
        } else {
            // bestselling / high stock
            list.sort((a, b) => Number(b.stock || 0) - Number(a.stock || 0))
        }

        return list
    }, [products, search, categoryFilter, collectionFilter, statusFilter, sortBy])

    const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
    const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
    useEffect(() => { if (page > totalPages) setPage(1) }, [totalPages, page])

    /* ===============================================================
       FORM HANDLERS
    =============================================================== */
    const onField = (e) => {
        const { name, value } = e.target
        setForm((f) => ({ ...f, [name]: value }))
        if (name === "category" && !policyTouched.current) setPolicy(policyForCategory(storePolicy, categoryLists, value))
    }

    const onThumb = (e) => {
        const file = e.target.files[0]
        if (!file) return
        const v = validateImageFile(file)
        if (!v.ok) { alert(v.error); e.target.value = ""; return }
        setThumbFile(file)
        setThumbPreview(URL.createObjectURL(file))
    }

    const onGallery = (e) => {
        const files = [...e.target.files]
        const v = validateImageFiles(files)
        if (!v.ok) { alert(v.error); e.target.value = ""; return }
        setGalleryFiles(files)
        setGalleryPreviews(files.map((f) => URL.createObjectURL(f)))
    }

    const clearForm = () => {
        setForm(EMPTY_FORM); setStatus("active"); setAddingCategory(false)
        setThumbFile(null); setThumbPreview(""); setGalleryFiles([]); setGalleryPreviews([])
        setUploadProgress(0)
        setProductType("single"); setAttributes([]); setVariantRows([])
        setMainOptionEnabled(true); setTrackInventory(true); setTagsText(""); setPolicy({ ...storePolicy }); policyTouched.current = false
    }

    useEffect(() => {
        supabase.from("settings").select("data").eq("id", "returnPolicyDefaults").maybeSingle().then(({ data }) => {
            if (!data?.data) return
            const d = policyFromSettings(data.data)
            setStorePolicy(d); setPolicy(d); setCategoryLists(categoryListsFromSettings(data.data))
        })
    }, [])

    /* ===============================================================
       SAVE PRODUCT
    =============================================================== */
    const saveProduct = async (saveStatus) => {
        const problem = validateProduct({
            form, productType, variantRows, mainOptionEnabled, policy,
            hasPrimaryImage: !!(thumbFile || thumbPreview), requireImage: true,
        })
        if (problem) return alert(problem)

        setLoading(true); setUploadProgress(5)
        const uploaded = []
        const upload = async (path, file) => {
            const { error } = await supabase.storage.from("products").upload(path, file, { upsert: true })
            if (error) throw error
            uploaded.push(path)
            return supabase.storage.from("products").getPublicUrl(path).data.publicUrl
        }
        try {
            const productId = `prod_${Date.now()}`
            let thumbUrl = ""
            if (thumbFile) thumbUrl = await upload(`${productId}/thumbnail/${thumbFile.name}`, thumbFile)
            setUploadProgress(25)

            const galleryUrls = []
            for (let i = 0; i < galleryFiles.length; i++) {
                galleryUrls.push(await upload(`${productId}/gallery/${galleryFiles[i].name}`, galleryFiles[i]))
                setUploadProgress(25 + Math.round(((i + 1) / galleryFiles.length) * 70))
            }
            setUploadProgress(100)

            const isVariant = productType === "variant"
            const variantsPayload = []
            for (const v of variantRows) {
                let vImgUrl = v.imageUrl || ""
                if (v.imageFile) vImgUrl = await upload(`${productId}/variants/${v.id}/${v.imageFile.name}`, v.imageFile)
                variantsPayload.push(buildVariantPayload(v, { imageUrl: vImgUrl, attributes }))
            }

            const { error: saveErr } = await supabase.rpc("save_product", {
                p_product: buildProductPayload({
                    id: productId, form, status: saveStatus, productType, mainOptionEnabled, trackInventory,
                    policy, tagsText, thumbnail: thumbUrl, gallery: galleryUrls, attributes,
                }),
                p_variants: isVariant ? variantsPayload : [],
            })
            if (saveErr) throw saveErr
            alert(`Product ${saveStatus === "draft" ? "saved as draft" : "saved"} successfully`)
            clearForm()
            setShowAddForm(false)
        } catch (err) {
            console.error(err)
            if (uploaded.length) supabase.storage.from("products").remove(uploaded).catch(() => { })
            alert(explainSaveError(err))
        } finally {
            setLoading(false)
        }
    }

    /* ===============================================================
       CSV HELPERS
    =============================================================== */
    const getCsvVal = (row, ...aliases) => {
        if (!row) return undefined
        const keys = Object.keys(row)
        for (const alias of aliases) {
            const cleanAlias = alias.toLowerCase().replace(/[^a-z0-9]/g, "")
            for (const key of keys) {
                if (key.trim().toLowerCase().replace(/[^a-z0-9]/g, "") === cleanAlias) return row[key]
            }
        }
        return undefined
    }

    const parseCsvNumber = (val, fallback = 0) => {
        if (val == null || val === "") return fallback
        if (typeof val === "number") return isNaN(val) ? fallback : val
        const cleaned = String(val).replace(/[^0-9.-]/g, "").trim()
        const num = Number(cleaned)
        return isNaN(num) ? fallback : num
    }

    const downloadSampleCsv = () => {
        const csv = Papa.unparse({ fields: PRODUCT_IMPORT_HEADERS, data: [PRODUCT_IMPORT_SAMPLE_ROW] })
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url; a.download = "product-import-sample.csv"
        document.body.appendChild(a); a.click()
        document.body.removeChild(a); URL.revokeObjectURL(url)
    }

    const exportProductsCsv = () => {
        if (!products.length) return alert("No products to export")
        const rows = products.map((p) => ({
            Title: p.title,
            Category: p.category,
            Price: p.price,
            Stock: p.stock,
            SKU: p.sku || "",
            Brand: p.brand || "",
            Status: p.status,
            GST_Rate: p.gstRate || "0",
            HSN_Code: p.hsnCode || "",
            Short_Description: p.shortDescription || "",
        }))
        const csv = Papa.unparse(rows)
        const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" })
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url; a.download = `products-catalog-${new Date().toISOString().slice(0, 10)}.csv`
        document.body.appendChild(a); a.click()
        document.body.removeChild(a); URL.revokeObjectURL(url)
    }

    useEffect(() => {
        if (actionsRef) {
            actionsRef.current = {
                exportCsv: exportProductsCsv,
                toggleCsvImport: () => setShowCsvImport((v) => !v),
                openBulkZip: () => setBulkOpen(true),
                toggleNewProduct: () => {
                    setShowAddForm((v) => !v)
                    if (!showAddForm) {
                        setTimeout(() => formSectionRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
                    }
                },
            }
        }
    }, [actionsRef, showAddForm, products])

    const onCsv = (file) => {
        if (!file) return
        setCsvName(file.name)
        Papa.parse(file, {
            header: true, skipEmptyLines: true,
            transformHeader: (h) => h.trim(),
            complete: (res) => {
                const rows = res.data.map((r) => {
                    const title = String(getCsvVal(r, "title", "name", "productName") || "").trim()
                    const rawPrice = getCsvVal(r, "price", "mrp", "unit price", "rate")
                    const parsedPrice = parseCsvNumber(rawPrice, null)
                    const category = String(getCsvVal(r, "category", "cat") || "").trim()
                    const sku = String(getCsvVal(r, "sku", "item code", "product code") || "—").trim()
                    let error = ""
                    if (!title) error = "Missing Title"
                    else if (parsedPrice === null || isNaN(parsedPrice)) error = "Missing Price"
                    else if (!category) error = "Missing Category"
                    return { raw: r, sku: sku || "—", title, price: parsedPrice !== null ? parsedPrice : rawPrice, category, valid: !error, error }
                })
                setCsvRows(rows)
            },
        })
    }

    const startBatchUpload = async () => {
        const valid = csvRows.filter((r) => r.valid)
        if (valid.length === 0) return alert("No valid rows to upload")
        setLoading(true)
        try {
            const rows = valid.map((r, i) => ({
                id: `prod_${Date.now()}_${i}`,
                title: r.title, category: r.category || "general",
                price: parseCsvNumber(r.price, 0),
                stock: parseCsvNumber(getCsvVal(r.raw, "stock", "quantity", "qty"), 0),
                brand: String(getCsvVal(r.raw, "brand", "company", "manufacturer") || "").trim(),
                sku: r.sku === "—" ? "" : r.sku,
                gst_rate: parseCsvNumber(getCsvVal(r.raw, "gstRate", "gst", "gst_rate"), 0),
                hsn_code: String(getCsvVal(r.raw, "hsnCode", "hsn", "hsn_code") || "").trim(),
                price_type: "inclusive",
                short_description: String(getCsvVal(r.raw, "shortDescription", "short_description", "summary") || "").trim(),
                description: String(getCsvVal(r.raw, "description", "desc", "details") || "").trim(),
                thumbnail: String(getCsvVal(r.raw, "image", "thumbnail", "img", "imageUrl", "photo") || "").trim(),
                gallery: [], status: "active",
            }))
            const { error } = await supabase.from("products").insert(rows)
            if (error) throw error
            alert(`Uploaded ${valid.length} products`)
            setCsvRows([]); setCsvName("")
            setShowCsvImport(false)
        } catch (err) {
            console.error(err); alert("Batch upload failed")
        } finally {
            setLoading(false)
        }
    }

    /* ===============================================================
       DELETE PRODUCT
    =============================================================== */
    const deleteProduct = async (id, productId) => {
        if (!window.confirm("Delete this product and its images?")) return
        try {
            setLoading(true)
            await supabase.from("cart_items").delete().eq("product_id", id)
            const { error } = await supabase.from("products").delete().eq("id", id)
            if (error) throw error

            if (productId) {
                const delFolder = async (path) => {
                    const { data: entries } = await supabase.storage.from("products").list(path)
                    if (!entries?.length) return
                    const filePaths = []
                    for (const entry of entries) {
                        const entryPath = `${path}/${entry.name}`
                        if (entry.id === null) await delFolder(entryPath)
                        else filePaths.push(entryPath)
                    }
                    if (filePaths.length) await supabase.storage.from("products").remove(filePaths)
                }
                await delFolder(productId).catch(() => { })
            }
            if (selected?.id === id) closeDrawer()
        } catch (err) {
            console.error(err)
            alert("Failed to delete product: " + (err?.message || err))
        } finally {
            setLoading(false)
        }
    }

    /* ===============================================================
       DRAWER
    =============================================================== */
    const openDrawer = (p) => { setDrawerImg(0); setSelected(p); setDisplayedProduct(p) }
    const closeDrawer = () => setSelected(null)

    const galleryImagesForDrawer = displayedProduct
        ? [displayedProduct.thumbnail, ...(displayedProduct.gallery || [])].filter(Boolean)
        : []

    return (
        <div ref={rootRef} style={{ fontFamily: FONT, color: INK, padding: showHeader ? "16px 20px 80px" : "0 0 80px", maxWidth: "1580px", margin: "0 auto" }}>

            {showHeader && (
                <>
                    {/* Top Bar: Date ranges + status badges */}
                    <header className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3 pt-1 mb-4">
                        {/* Date Pills Container */}
                        <div className="inline-flex items-center bg-[#DDD7CD]/80 rounded-full p-1 text-[12px] font-medium text-[#524B41] max-w-fit overflow-x-auto no-scrollbar shadow-inner">
                            {DATE_RANGES.map((r) => {
                                const active = dateRange === r.key
                                return (
                                    <button
                                        key={r.key}
                                        onClick={() => setDateRange(r.key)}
                                        className={`px-2.5 py-1 whitespace-nowrap rounded-full transition-all ${active
                                            ? "bg-white text-[#1C1814] font-semibold shadow-sm"
                                            : "hover:text-[#1F1C18]"
                                            }`}
                                        type="button"
                                    >
                                        {r.label}
                                    </button>
                                )
                            })}
                        </div>

                        {/* Right Quick Actions */}
                        <div className="flex items-center gap-2 self-end md:self-auto">
                            {/* Active orders pill */}
                            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-[#DDD7CD]/80 rounded-full text-[12px] font-semibold text-[#1C1917]">
                                <span className="w-2 h-2 rounded-full bg-[#115E59] animate-pulse"></span>
                                <span>396 today</span>
                                <span className="text-[#787166] font-normal">₹25k</span>
                            </div>

                            {/* Moon mode toggle */}
                            <button
                                type="button"
                                className="w-8 h-8 rounded-full bg-[#DDD7CD]/80 flex items-center justify-center text-[#554E44] hover:bg-white hover:text-black transition-colors"
                                title="Dark mode"
                            >
                                <Moon size={15} />
                            </button>

                            {/* Notification bell */}
                            <button
                                type="button"
                                className="w-8 h-8 rounded-full bg-[#DDD7CD]/80 flex items-center justify-center text-[#554E44] hover:bg-white hover:text-black transition-colors relative"
                                title="Notifications"
                            >
                                <Bell size={15} />
                                <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 bg-[#E1432E] rounded-full ring-2 ring-white"></span>
                            </button>
                        </div>
                    </header>

                    {/* Page Title & Primary Actions */}
                    <section className="flex flex-wrap items-end justify-between gap-4 pt-1 mb-4" data-purpose="header-section">
                        <div>
                            <p className="text-[11px] font-medium text-[#7C746A]">Fernhill Ceramics · thrown, glazed and fired on Quay Street</p>
                            <h2 className="text-3xl font-extrabold text-[#111C17] tracking-tight">Products</h2>
                        </div>

                        <div className="flex items-center gap-2.5 flex-wrap">
                            <button
                                onClick={exportProductsCsv}
                                className="flex items-center gap-1.5 px-4 py-2 bg-[#FBF9F5] border border-[#D5CCC0] rounded-full text-[13px] font-semibold text-[#1C1814] hover:bg-white shadow-sm transition-all"
                                type="button"
                            >
                                <Download size={14} className="text-stone-500" />
                                <span>Export</span>
                            </button>

                            <button
                                onClick={() => setShowCsvImport(!showCsvImport)}
                                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-[13px] font-semibold transition-all border ${showCsvImport ? "bg-teal-50 border-teal-600 text-teal-800" : "bg-[#FBF9F5] border-[#D5CCC0] text-[#1C1814] hover:bg-white shadow-sm"
                                    }`}
                                type="button"
                            >
                                <UploadCloud size={14} className="text-stone-500" />
                                <span>Quick CSV</span>
                            </button>

                            <button
                                onClick={() => setBulkOpen(true)}
                                className="flex items-center gap-1.5 px-4 py-2 bg-[#FBF9F5] border border-[#D5CCC0] rounded-full text-[13px] font-semibold text-[#1C1814] hover:bg-white shadow-sm transition-all"
                                type="button"
                            >
                                <FileSpreadsheet size={14} className="text-stone-500" />
                                <span>Bulk ZIP</span>
                            </button>

                            <button
                                onClick={() => {
                                    setShowAddForm(!showAddForm)
                                    if (!showAddForm) {
                                        setTimeout(() => formSectionRef.current?.scrollIntoView({ behavior: "smooth" }), 100)
                                    }
                                }}
                                className={`flex items-center gap-1 px-4 py-2 rounded-full text-[13px] font-bold text-white shadow-sm transition-all ${showAddForm ? "bg-[#B83E28] hover:bg-[#96301E]" : "bg-[#103D37] hover:bg-[#0c312c]"
                                    }`}
                                type="button"
                            >
                                {showAddForm ? <X size={14} /> : <span className="text-base leading-none mb-0.5">+</span>}
                                <span>{showAddForm ? "Close Form" : "New product"}</span>
                            </button>
                        </div>
                    </section>

                    {/* KPI Metrics Strip (6 cards) */}
                    <section className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3 mb-4" data-purpose="kpi-metric-cards">
                        {/* 1. Active products */}
                        <div className="bg-[#FBF9F5] border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6E665B]">
                                <span className="text-[#157A6E]">💧</span>
                                <span>Active products</span>
                            </div>
                            <div className="text-2xl font-black text-[#141C18] mt-1.5 leading-tight">{stats.total}</div>
                            <div className="text-[11px] text-[#8C8478] font-medium mt-0.5">all in the shop</div>
                        </div>

                        {/* 2. Active Categories */}
                        <div className="bg-[#FBF9F5] border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6E665B]">
                                <span className="text-[#157A6E]">💧</span>
                                <span>Active Categories</span>
                            </div>
                            <div className="text-2xl font-black text-[#141C18] mt-1.5 leading-tight">{stats.activeCategories}</div>
                            <div className="text-[11px] text-[#8C8478] font-medium mt-0.5">all in the shop</div>
                        </div>

                        {/* 3. Low on stock */}
                        <div className="bg-[#FBF9F5] border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between">
                            <div className="flex items-center gap-1 text-[11px] font-semibold text-[#6E665B]">
                                <span>⚠️!</span>
                                <span className="ml-0.5">Low on stock</span>
                            </div>
                            <div className="flex items-baseline gap-2 mt-1.5">
                                <span className="text-2xl font-black text-[#141C18] leading-tight">{stats.lowStock}</span>
                                <span className="bg-[#F9EDCF] text-[#9A620E] text-[10px] font-bold px-1.5 py-0.5 rounded-md">14 not booked</span>
                            </div>
                            <div className="text-[11px] text-[#8C8478] font-medium mt-0.5">attention required</div>
                        </div>

                        {/* 4. Out of Stock */}
                        <div className="bg-[#FBF9F5] border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6E665B]">
                                <span className="text-[#787167]">🏺</span>
                                <span>Out of Stock</span>
                            </div>
                            <div className={`text-2xl font-black mt-1.5 leading-tight ${stats.outStock > 0 ? "text-[#B83E28]" : "text-[#141C18]"}`}>{stats.outStock}</div>
                            <div className="text-[11px] text-[#8C8478] font-medium mt-0.5">next Oct 22</div>
                        </div>

                        {/* 5. Added This Month */}
                        <div className="bg-[#FBF9F5] border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6E665B]">
                                <span className="text-[#157A6E]">💧</span>
                                <span>Added This Month</span>
                            </div>
                            <div className="text-2xl font-black text-[#141C18] mt-1.5 leading-tight">{stats.addedThisMonth}</div>
                            <div className="text-[11px] text-[#8C8478] font-medium mt-0.5">all in the shop</div>
                        </div>

                        {/* 6. Stock value, at cost */}
                        <div className="bg-[#FBF9F5] border border-[#DDD6CB] rounded-2xl p-3.5 shadow-sm flex flex-col justify-between">
                            <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[#6E665B]">
                                <span>📦</span>
                                <span>Stock value, at cost</span>
                            </div>
                            <div className="text-2xl font-black text-[#141C18] mt-1.5 leading-tight">{money(stats.totalStockValue)}</div>
                            <div className="text-[11px] text-[#8C8478] font-medium mt-0.5">{stats.total} items</div>
                        </div>
                    </section>

                    {/* Sub Tabs: Catalog vs Analytics */}
                    <div className="flex items-center gap-6 border-b border-[#DDD5C9] pt-1 mb-3">
                        <button
                            className="flex items-center gap-1.5 pb-2 border-b-2 border-[#103D37] font-bold text-[14px] text-[#131D18]"
                            type="button"
                        >
                            <span>Catalog</span>
                            <span className="text-xs bg-[#DDD7CD] text-[#4A443A] font-medium px-1.5 py-0.2 rounded-full leading-none">{stats.total}</span>
                        </button>
                        <button
                            onClick={() => onSwitchTab?.("analytics")}
                            className="pb-2 font-medium text-[14px] text-[#716A60] hover:text-[#1C1814] transition-colors"
                            type="button"
                        >
                            Analytics
                        </button>
                    </div>
                </>
            )}

            {/* Categories Filter Chips */}
            <div className="flex items-center gap-2 overflow-x-auto no-scrollbar py-1 mb-3">
                <button
                    onClick={() => { setCategoryFilter("all"); setPage(1) }}
                    className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-all ${categoryFilter === "all"
                        ? "bg-[#18231F] text-white shadow-sm"
                        : "bg-[#FBF9F5] border border-[#DDD5C9] text-[#2C2720] hover:bg-white"
                        }`}
                    type="button"
                >
                    All {products.length}
                </button>
                {categories.map((c) => {
                    const count = products.filter((p) => p.category === c).length
                    const active = categoryFilter === c
                    const icon = getCategoryIcon(c)
                    return (
                        <button
                            key={c}
                            onClick={() => { setCategoryFilter(c); setPage(1) }}
                            className={`px-3.5 py-1.5 rounded-full text-[12px] font-semibold flex items-center gap-1.5 transition-all whitespace-nowrap ${active
                                ? "bg-[#18231F] text-white shadow-sm"
                                : "bg-[#FBF9F5] border border-[#DDD5C9] text-[#2C2720] hover:bg-white"
                                }`}
                            type="button"
                        >
                            <span>{icon}</span>
                            <span className="capitalize">{c}</span>
                            <span className={active ? "text-stone-300" : "text-[#888176]"}>{count}</span>
                        </button>
                    )
                })}
            </div>

            {/* Search, Collections dropdown, Sort and View Switcher */}
            <section className="flex flex-col md:flex-row md:items-center justify-between gap-3 pt-1 mb-3" data-purpose="filtering-bar">
                {/* Search bar */}
                <div className="relative flex-1 max-w-xl">
                    <span className="absolute inset-y-0 left-3.5 flex items-center pointer-events-none text-stone-400">
                        <Search size={15} />
                    </span>
                    <input
                        value={search}
                        onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                        className="w-full pl-10 pr-4 py-2 bg-[#FBF9F5] border border-[#DDD5C9] rounded-full text-[13px] placeholder-[#8E867B] text-[#1E1914] focus:outline-none focus:ring-1 focus:ring-[#103D37]"
                        placeholder="Search items, glazes, SKUs"
                        type="text"
                    />
                </div>

                {/* Controls: All collections, Best selling, Grid/List */}
                <div className="flex items-center gap-2 self-start md:self-auto flex-wrap">
                    {/* All collections dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setShowCollectionsDropdown(!showCollectionsDropdown)}
                            className="flex items-center gap-2 px-3.5 py-2 bg-[#FBF9F5] border border-[#DDD5C9] rounded-full text-[12px] font-semibold text-[#2B251E] hover:bg-white shadow-2xs"
                            type="button"
                        >
                            <SlidersHorizontal size={14} className="text-stone-500" />
                            <span>{collectionFilter === "all" ? "All collections" : collectionFilter}</span>
                            <ChevronDown size={12} className="text-stone-400" />
                        </button>
                        {showCollectionsDropdown && (
                            <div className="absolute right-0 mt-1 w-44 bg-white rounded-xl shadow-lg border border-[#DDD5C9] py-1 z-30">
                                <button
                                    onClick={() => { setCollectionFilter("all"); setShowCollectionsDropdown(false) }}
                                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#F3EFE9] ${collectionFilter === "all" ? "font-bold text-[#103D37]" : "text-[#1E1914]"}`}
                                    type="button"
                                >
                                    All collections
                                </button>
                                {categories.map((cat) => (
                                    <button
                                        key={cat}
                                        onClick={() => { setCollectionFilter(cat); setShowCollectionsDropdown(false) }}
                                        className={`w-full text-left px-3 py-1.5 text-xs capitalize hover:bg-[#F3EFE9] ${collectionFilter === cat ? "font-bold text-[#103D37]" : "text-[#1E1914]"}`}
                                        type="button"
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Best selling sort */}
                    <div className="relative">
                        <button
                            onClick={() => setShowSortDropdown(!showSortDropdown)}
                            className="flex items-center gap-2 px-3.5 py-2 bg-[#FBF9F5] border border-[#DDD5C9] rounded-full text-[12px] font-semibold text-[#2B251E] hover:bg-white shadow-2xs"
                            type="button"
                        >
                            <ArrowUpDown size={14} className="text-stone-500" />
                            <span>{SORT_OPTIONS.find(s => s.key === sortBy)?.label || "Best selling"}</span>
                            <ChevronDown size={12} className="text-stone-400" />
                        </button>
                        {showSortDropdown && (
                            <div className="absolute right-0 mt-1 w-48 bg-white rounded-xl shadow-lg border border-[#DDD5C9] py-1 z-30">
                                {SORT_OPTIONS.map((opt) => (
                                    <button
                                        key={opt.key}
                                        onClick={() => { setSortBy(opt.key); setShowSortDropdown(false) }}
                                        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-[#F3EFE9] ${sortBy === opt.key ? "font-bold text-[#103D37]" : "text-[#1E1914]"}`}
                                        type="button"
                                    >
                                        {opt.label}
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Grid/List Toggle */}
                    <div className="flex items-center bg-[#DDD5C8]/80 p-0.5 rounded-full text-[12px] font-medium text-[#504A41]">
                        <button
                            onClick={() => setViewMode("grid")}
                            className={`px-2.5 py-1 rounded-full text-xs transition-all ${viewMode === "grid" ? "bg-white text-black font-semibold shadow-xs" : "text-[#655E53] hover:text-black"
                                }`}
                            type="button"
                        >
                            Grid
                        </button>
                        <button
                            onClick={() => setViewMode("list")}
                            className={`px-2.5 py-1 rounded-full text-xs transition-all ${viewMode === "list" ? "bg-white text-black font-semibold shadow-xs" : "text-[#655E53] hover:text-black"
                                }`}
                            type="button"
                        >
                            List
                        </button>
                    </div>
                </div>
            </section>

            {/* Items Count Text */}
            <div className="text-[11px] font-medium text-[#7D756A] pt-0.5 mb-2">
                {filtered.length} items, all for sale
            </div>

            {/* QUICK CSV IMPORT CARD (Collapsible) */}
            {showCsvImport && (
                <div style={{ background: WHITE, borderRadius: "20px", border: `1.5px dashed ${BORDER}`, padding: "20px", marginBottom: "24px" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
                        <div>
                            <h3 style={{ fontSize: "15px", fontWeight: 800, color: INK, margin: 0 }}>Quick CSV Product Import</h3>
                            <p style={{ fontSize: "12px", color: MUTED, margin: "2px 0 0" }}>Upload a CSV with single products & image URLs</p>
                        </div>
                        <button onClick={downloadSampleCsv} style={{ padding: "6px 14px", borderRadius: "8px", border: `1px solid ${BORDER}`, background: "#FAF9F7", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>
                            Download CSV Template
                        </button>
                    </div>

                    <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "30px", borderRadius: "14px", border: `1.5px dashed ${TEAL}`, background: TEAL_SUBTLE, cursor: "pointer" }}>
                        <UploadCloud size={28} style={{ color: TEAL, marginBottom: "8px" }} />
                        <span style={{ fontWeight: 700, fontSize: "13px", color: TEAL }}>{csvName || "Click or drop CSV file here"}</span>
                        <span style={{ fontSize: "11px", color: MUTED, marginTop: "4px" }}>Up to 5,000 products per file</span>
                        <input type="file" accept=".csv" className="hidden" onChange={(e) => onCsv(e.target.files[0])} />
                    </label>

                    {csvRows.length > 0 && (
                        <div style={{ marginTop: "14px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 700, marginBottom: "6px" }}>
                                <span>Preview: {csvRows.length} rows parsed</span>
                                <span style={{ color: GREEN }}>{csvRows.filter((r) => r.valid).length} valid</span>
                            </div>
                            <div style={{ maxHeight: "150px", overflowY: "auto", border: `1px solid ${BORDER}`, borderRadius: "8px", fontSize: "11px" }}>
                                {csvRows.slice(0, 5).map((r, i) => (
                                    <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", borderBottom: `1px solid ${BORDER}`, background: r.valid ? "#FFF" : "#FEF2F2" }}>
                                        <span style={{ fontWeight: 600 }}>{r.title}</span>
                                        <span style={{ color: r.valid ? GREEN : RED }}>{r.valid ? `₹${r.price}` : r.error}</span>
                                    </div>
                                ))}
                            </div>
                            <button
                                onClick={startBatchUpload}
                                disabled={loading}
                                style={{ marginTop: "12px", width: "100%", height: "42px", borderRadius: "10px", background: TEAL, color: WHITE, fontWeight: 700, fontSize: "13px", border: "none", cursor: "pointer" }}
                            >
                                {loading ? "Uploading products..." : `Upload ${csvRows.filter((r) => r.valid).length} Valid Products`}
                            </button>
                        </div>
                    )}
                </div>
            )}

            {/* ADD PRODUCT FORM (COLLAPSIBLE / EXPANDABLE) */}
            {showAddForm && (
                <div ref={formSectionRef} style={{ background: WHITE, borderRadius: "20px", border: `1.5px solid ${TEAL}`, padding: "24px", marginBottom: "28px", boxShadow: "0 4px 20px rgba(16,73,69,0.08)" }}>
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: `1px solid ${BORDER}`, paddingBottom: "14px", marginBottom: "20px" }}>
                        <div>
                            <h3 style={{ fontSize: "17px", fontWeight: 800, color: INK, margin: 0 }}>Add New Product</h3>
                            <p style={{ fontSize: "12px", color: MUTED, margin: "2px 0 0" }}>Create a standalone item or product with color/size variants</p>
                        </div>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: TEAL, background: TEAL_SUBTLE, padding: "4px 10px", borderRadius: "9999px" }}>
                            {productType === "variant" ? "Multi-Variant" : "Single Product"}
                        </span>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {/* Title */}
                        <div className="md:col-span-2">
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: "6px" }}>Product Title *</label>
                            <input
                                name="title"
                                value={form.title}
                                onChange={onField}
                                placeholder="e.g. Handmade Ceramic Stoneware Mug"
                                style={{ width: "100%", height: "40px", padding: "0 12px", borderRadius: "10px", border: `1px solid ${BORDER}`, background: "#FAF9F7", fontSize: "13px", outline: "none", fontFamily: FONT }}
                            />
                        </div>

                        {/* Category */}
                        <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: "6px" }}>Category *</label>
                            <div style={{ display: "flex", gap: "8px" }}>
                                <input
                                    name="category"
                                    value={form.category}
                                    onChange={onField}
                                    placeholder="e.g. Mugs, Plates, Vases"
                                    style={{ flex: 1, height: "40px", padding: "0 12px", borderRadius: "10px", border: `1px solid ${BORDER}`, background: "#FAF9F7", fontSize: "13px", outline: "none", fontFamily: FONT }}
                                />
                            </div>
                        </div>

                        {/* Price */}
                        <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: "6px" }}>Price (₹) *</label>
                            <input
                                name="price"
                                type="number"
                                value={form.price}
                                onChange={onField}
                                placeholder="0.00"
                                style={{ width: "100%", height: "40px", padding: "0 12px", borderRadius: "10px", border: `1px solid ${BORDER}`, background: "#FAF9F7", fontSize: "13px", outline: "none", fontFamily: FONT }}
                            />
                        </div>

                        {/* Stock */}
                        <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: "6px" }}>Stock Quantity *</label>
                            <input
                                name="stock"
                                type="number"
                                value={form.stock}
                                onChange={onField}
                                placeholder="0"
                                style={{ width: "100%", height: "40px", padding: "0 12px", borderRadius: "10px", border: `1px solid ${BORDER}`, background: "#FAF9F7", fontSize: "13px", outline: "none", fontFamily: FONT }}
                            />
                        </div>

                        {/* SKU */}
                        <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: "6px" }}>SKU Code</label>
                            <input
                                name="sku"
                                value={form.sku}
                                onChange={onField}
                                placeholder="e.g. APX-009"
                                style={{ width: "100%", height: "40px", padding: "0 12px", borderRadius: "10px", border: `1px solid ${BORDER}`, background: "#FAF9F7", fontSize: "13px", outline: "none", fontFamily: FONT }}
                            />
                        </div>

                        {/* GST Rate */}
                        <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: "6px" }}>GST Rate (%)</label>
                            <select
                                name="gstRate"
                                value={form.gstRate}
                                onChange={onField}
                                style={{ width: "100%", height: "40px", padding: "0 12px", borderRadius: "10px", border: `1px solid ${BORDER}`, background: "#FAF9F7", fontSize: "13px", outline: "none", fontFamily: FONT }}
                            >
                                {GST_RATES.map((r) => <option key={r} value={r}>{r === "0" ? "0% (Exempt)" : `${r}%`}</option>)}
                            </select>
                        </div>

                        {/* HSN Code */}
                        <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: "6px" }}>HSN Code</label>
                            <input
                                name="hsnCode"
                                value={form.hsnCode}
                                onChange={onField}
                                placeholder="e.g. 6911"
                                style={{ width: "100%", height: "40px", padding: "0 12px", borderRadius: "10px", border: `1px solid ${BORDER}`, background: "#FAF9F7", fontSize: "13px", outline: "none", fontFamily: FONT }}
                            />
                        </div>

                        {/* Short Description */}
                        <div className="md:col-span-2">
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: "6px" }}>Short Description</label>
                            <input
                                name="shortDescription"
                                value={form.shortDescription}
                                onChange={onField}
                                placeholder="Quick one-line summary..."
                                style={{ width: "100%", height: "40px", padding: "0 12px", borderRadius: "10px", border: `1px solid ${BORDER}`, background: "#FAF9F7", fontSize: "13px", outline: "none", fontFamily: FONT }}
                            />
                        </div>

                        {/* Full Description */}
                        <div className="md:col-span-2">
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: "6px" }}>Full Description</label>
                            <textarea
                                name="description"
                                value={form.description}
                                onChange={onField}
                                rows={3}
                                placeholder="Detailed product specifications, clay type, firing methods, glaze care..."
                                style={{ width: "100%", padding: "10px 12px", borderRadius: "10px", border: `1px solid ${BORDER}`, background: "#FAF9F7", fontSize: "13px", outline: "none", fontFamily: FONT }}
                            />
                        </div>

                        {/* Return Policy Fields */}
                        <div className="md:col-span-2">
                            <PolicyFields idPrefix="product-policy" value={policy} onChange={(p) => { policyTouched.current = true; setPolicy(p) }} />
                        </div>
                    </div>

                    {/* MEDIA UPLOADS */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4 pt-4 border-t" style={{ borderColor: BORDER }}>
                        <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: "6px" }}>Primary Thumbnail Image *</label>
                            <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "130px", borderRadius: "12px", border: `1.5px dashed ${BORDER}`, background: "#FAF9F7", cursor: "pointer", overflow: "hidden" }}>
                                {thumbPreview ? (
                                    <img src={thumbPreview} alt="Thumbnail preview" style={{ width: "100%", height: "100%", objectCover: "cover" }} />
                                ) : (
                                    <div style={{ textAlign: "center", color: MUTED, fontSize: "12px" }}>
                                        <UploadCloud size={24} style={{ margin: "0 auto 4px", color: TEAL }} />
                                        <span>Click to upload primary image</span>
                                    </div>
                                )}
                                <input type="file" accept="image/*" className="hidden" onChange={onThumb} />
                            </label>
                        </div>

                        <div>
                            <label style={{ display: "block", fontSize: "11px", fontWeight: 700, color: MUTED, textTransform: "uppercase", marginBottom: "6px" }}>Gallery Images ({galleryPreviews.length})</label>
                            <label style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "130px", borderRadius: "12px", border: `1.5px dashed ${BORDER}`, background: "#FAF9F7", cursor: "pointer", overflow: "hidden" }}>
                                <div style={{ textAlign: "center", color: MUTED, fontSize: "12px" }}>
                                    <UploadCloud size={24} style={{ margin: "0 auto 4px", color: TEAL }} />
                                    <span>{galleryPreviews.length ? `${galleryPreviews.length} images selected (click to replace)` : "Upload multiple gallery photos"}</span>
                                </div>
                                <input type="file" accept="image/*" multiple className="hidden" onChange={onGallery} />
                            </label>
                        </div>
                    </div>

                    {/* PRODUCT TYPE + VARIANTS */}
                    <div style={{ marginTop: "16px" }}>
                        <ProductTypeSection
                            productType={productType}
                            onTypeChange={(val) => { setProductType(val); setAttributes([]); setVariantRows([]) }}
                            mainOptionEnabled={mainOptionEnabled}
                            onMainOptionChange={setMainOptionEnabled}
                            mainPrice={form.price}
                            mainStock={form.stock}
                        />
                        {productType === "variant" && (
                            <VariantManager mode="add" attributes={attributes} setAttributes={setAttributes} variantRows={variantRows} setVariantRows={setVariantRows} />
                        )}
                    </div>

                    {/* FOOTER ACTIONS */}
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: "20px", paddingTop: "16px", borderTop: `1px solid ${BORDER}` }}>
                        <button onClick={clearForm} style={{ background: "none", border: "none", color: MUTED, fontSize: "12px", fontWeight: 700, cursor: "pointer" }}>Clear Form</button>
                        <div style={{ display: "flex", gap: "10px" }}>
                            <button
                                disabled={loading}
                                onClick={() => saveProduct("draft")}
                                style={{ padding: "8px 18px", borderRadius: "10px", border: `1px solid ${BORDER}`, background: WHITE, color: INK, fontSize: "12px", fontWeight: 700, cursor: "pointer" }}
                            >
                                Save Draft
                            </button>
                            <button
                                disabled={loading}
                                onClick={() => saveProduct("active")}
                                style={{ padding: "8px 24px", borderRadius: "10px", border: "none", background: TEAL, color: WHITE, fontSize: "12px", fontWeight: 700, cursor: "pointer", boxShadow: "0 2px 6px rgba(16,73,69,0.2)" }}
                            >
                                {loading ? "Saving Product..." : "Publish Product"}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* PRODUCT CATALOG CARDS GRID (7 columns on xl) */}
            {viewMode === "grid" ? (
                <section className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-3 pt-1 mb-8" data-purpose="product-grid">
                    {pageItems.map((p, idx) => {
                        const stock = Number(p.stock || 0)
                        const isLow = stock < 10 && stock > 0
                        const isOut = stock === 0
                        const thumb = p.thumbnail || p.image || (Array.isArray(p.gallery) ? p.gallery[0] : "")
                        const grad = CERAMIC_GRADIENTS[idx % CERAMIC_GRADIENTS.length]
                        const soldVal = p.totalSold || (200 + (idx * 37) % 250)
                        const ordersVal = p.orderCount || (1 + (idx * 5) % 15)

                        return (
                            <article
                                key={p.id}
                                className="bg-[#FDFCFB] border border-[#DDD6CB] rounded-2xl p-2.5 shadow-sm flex flex-col justify-between hover:shadow-md transition-all hover:border-[#BDB4A8]"
                            >
                                <div>
                                    {/* Image or Ceramic Graphic */}
                                    <div className={`h-28 w-full rounded-xl bg-gradient-to-b ${grad} relative overflow-hidden flex items-center justify-center border border-[#CFD8D5]`}>
                                        {thumb ? (
                                            <img src={thumb} alt={p.title} className="w-full h-full object-cover" />
                                        ) : (
                                            <>
                                                <div className="w-16 h-16 rounded-full bg-[#DDD2C2] absolute -bottom-5 border-4 border-[#123632]/30" />
                                                <div className="w-3 h-3 rounded-full bg-white/90 absolute top-4 shadow-sm" />
                                            </>
                                        )}
                                        {p.hasVariants && (
                                            <span className="absolute top-2 right-2 text-[9px] font-bold bg-[#103D37]/90 text-white px-1.5 py-0.5 rounded shadow-xs">
                                                VARIANTS
                                            </span>
                                        )}
                                    </div>

                                    {/* Product Title & SKU */}
                                    <div className="mt-2.5">
                                        <h3 className="text-[13px] font-bold text-[#191613] leading-snug truncate" title={p.title}>
                                            {p.title}
                                        </h3>
                                        <p className="text-[10px] text-[#867F73] font-medium truncate font-mono">
                                            SKU: {p.sku || "APX-009"}
                                        </p>
                                    </div>

                                    {/* Badges: Category & Revenue */}
                                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                                        <span className="text-[10px] bg-[#EAE4DC] text-[#474136] px-1.5 py-0.5 rounded font-medium capitalize">
                                            {p.category || "General"}
                                        </span>
                                        <span className="text-[10px] bg-[#E5F1EE] text-[#0C6A5E] px-1.5 py-0.5 rounded font-semibold">
                                            Revenue {money(p.price)}
                                        </span>
                                    </div>

                                    {/* Sold & Orders */}
                                    <div className="flex justify-between items-center text-[10px] text-[#696257] font-medium mt-2">
                                        <span><b className="text-[#1A1815]">Sold</b> {soldVal}</span>
                                        <span><b className="text-[#1A1815]">Orders</b> {ordersVal}</span>
                                    </div>
                                </div>

                                {/* Footer: Stock Status & Controls */}
                                <div className="flex items-center justify-between pt-2.5 mt-2 border-t border-[#ECE5DC]">
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isOut
                                        ? "bg-[#FBECE8] text-[#B83E28]"
                                        : isLow
                                            ? "bg-[#FDF0DC] text-[#A66311]"
                                            : "bg-[#E4F3EF] text-[#0B665A]"
                                        }`}>
                                        {isOut ? "Out of stock" : isLow ? `${stock} left` : `${stock} `}
                                    </span>

                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => openDrawer(p)}
                                            className="p-1 text-[#867F73] hover:text-[#191613] rounded hover:bg-[#F3EFE9] transition-colors"
                                            title="View Details"
                                            type="button"
                                        >
                                            <Eye size={13} />
                                        </button>
                                        <button
                                            onClick={() => navigate(`/admin/edit-product/${p.id}`)}
                                            className="p-1 text-[#867F73] hover:text-[#191613] rounded hover:bg-[#F3EFE9] transition-colors"
                                            title="Edit Product"
                                            type="button"
                                        >
                                            <Pencil size={13} />
                                        </button>
                                        {/* Status Switch */}
                                        <div
                                            onClick={() => toggleProductStatus(p)}
                                            className={`w-7 h-3.5 rounded-full p-0.5 flex items-center cursor-pointer transition-colors ${p.status !== "draft" ? "bg-[#115E59] justify-end" : "bg-stone-300 justify-start"
                                                }`}
                                            title={p.status !== "draft" ? "Active (click to draft)" : "Draft (click to activate)"}
                                        >
                                            <div className="w-2.5 h-2.5 bg-white rounded-full shadow-sm" />
                                        </div>
                                    </div>
                                </div>
                            </article>
                        )
                    })}
                </section>
            ) : (
                /* PRODUCT CATALOG TABLE (When List Mode Active) */
                <div style={{ background: WHITE, borderRadius: "18px", border: `1px solid ${BORDER}`, overflow: "hidden", marginBottom: "24px", boxShadow: "0 1px 3px rgba(0,0,0,0.02)" }}>
                    <div style={{ overflowX: "auto" }}>
                        <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "12px" }}>
                            <thead>
                                <tr style={{ background: "#FAF8F5", borderBottom: `1.5px solid ${BORDER}` }}>
                                    <th style={{ padding: "12px 14px", fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>Image</th>
                                    <th style={{ padding: "12px 14px", fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>Product / SKU</th>
                                    <th style={{ padding: "12px 14px", fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>Category</th>
                                    <th style={{ padding: "12px 14px", fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>Price</th>
                                    <th style={{ padding: "12px 14px", fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>Stock</th>
                                    <th style={{ padding: "12px 14px", fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>Status</th>
                                    <th style={{ padding: "12px 14px", fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase", textAlign: "right" }}>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageItems.map((p) => {
                                    const stock = Number(p.stock || 0)
                                    const isLow = stock < 10 && stock > 0
                                    const isOut = stock === 0
                                    const thumb = p.thumbnail || p.image || (Array.isArray(p.gallery) ? p.gallery[0] : "")
                                    return (
                                        <tr key={p.id} style={{ borderBottom: `1px solid ${BORDER}`, transition: "background 0.1s" }} onMouseEnter={(e) => e.currentTarget.style.background = "#FAF8F5"} onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                                            <td style={{ padding: "10px 14px" }}>
                                                <div style={{ width: "42px", height: "42px", borderRadius: "8px", background: "#FAF8F5", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center" }}>
                                                    {thumb ? <img src={thumb} alt={p.title} style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Package size={18} style={{ color: MUTED }} />}
                                                </div>
                                            </td>
                                            <td style={{ padding: "10px 14px" }}>
                                                <div style={{ fontWeight: 700, fontSize: "13px", color: INK }}>{p.title}</div>
                                                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "2px" }}>
                                                    <span style={{ fontFamily: MONO, fontSize: "10px", color: MUTED }}>SKU: {p.sku || "—"}</span>
                                                    {p.hasVariants && <span style={{ fontSize: "9px", fontWeight: 700, background: TEAL_SUBTLE, color: TEAL, padding: "1px 5px", borderRadius: "4px" }}>VARIANTS</span>}
                                                </div>
                                            </td>
                                            <td style={{ padding: "10px 14px", textTransform: "capitalize", color: MUTED, fontWeight: 500 }}>
                                                {p.category}
                                            </td>
                                            <td style={{ padding: "10px 14px", fontWeight: 800, color: INK }}>
                                                {money(p.price)}
                                            </td>
                                            <td style={{ padding: "10px 14px" }}>
                                                <span style={{ fontSize: "10px", fontWeight: 700, padding: "2px 8px", borderRadius: "9999px", background: isOut ? "#FEE2E2" : isLow ? "#FEF3C7" : TEAL_SUBTLE, color: isOut ? "#991B1B" : isLow ? "#92400E" : TEAL }}>
                                                    {isOut ? "0 Out of Stock" : isLow ? `${stock} Low Stock` : `${stock} In Stock`}
                                                </span>
                                            </td>
                                            <td style={{ padding: "10px 14px" }}>
                                                <span style={{ display: "inline-flex", alignItems: "center", gap: "4px", fontSize: "11px", fontWeight: 600 }}>
                                                    <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: p.status === "draft" ? MUTED : GREEN }} />
                                                    {p.status === "draft" ? "Draft" : "Active"}
                                                </span>
                                            </td>
                                            <td style={{ padding: "10px 14px", textAlign: "right" }}>
                                                <div style={{ display: "inline-flex", alignItems: "center", gap: "4px" }}>
                                                    <button onClick={() => openDrawer(p)} style={{ padding: "4px 8px", borderRadius: "6px", border: `1px solid ${BORDER}`, background: WHITE, color: MUTED, cursor: "pointer" }} title="View">
                                                        <Eye size={13} />
                                                    </button>
                                                    <button onClick={() => navigate(`/admin/edit-product/${p.id}`)} style={{ padding: "4px 8px", borderRadius: "6px", border: `1px solid ${BORDER}`, background: WHITE, color: TEAL, cursor: "pointer" }} title="Edit">
                                                        <Pencil size={13} />
                                                    </button>
                                                    <button onClick={() => deleteProduct(p.id, p.productId)} style={{ padding: "4px 8px", borderRadius: "6px", border: `1px solid ${BORDER}`, background: WHITE, color: RED, cursor: "pointer" }} title="Delete">
                                                        <Trash2 size={13} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    )
                                })}
                            </tbody>
                        </table>
                    </div>
                </div>
            )}

            {/* PAGINATION */}
            {filtered.length > 0 && (
                <div style={{ marginTop: "16px" }}>
                    <Pagination
                        total={filtered.length}
                        page={page}
                        pageSize={PAGE_SIZE}
                        onPageChange={setPage}
                        itemLabel="products"
                        accent={TEAL}
                    />
                </div>
            )}

            {/* BULK PRODUCT IMPORTER (Modal) */}
            <BulkProductImport open={bulkOpen} onClose={() => setBulkOpen(false)} />

            {/* PRODUCT PREVIEW DRAWER */}
            <RightDrawer open={!!selected} onClose={closeDrawer} title="Product Details">
                {displayedProduct && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px", fontFamily: FONT }}>
                        {/* Primary Image Preview */}
                        <div style={{ width: "100%", height: "220px", borderRadius: "14px", background: "#FAF8F5", overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", border: `1px solid ${BORDER}` }}>
                            {galleryImagesForDrawer.length > 0 ? (
                                <img src={galleryImagesForDrawer[drawerImg] || galleryImagesForDrawer[0]} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            ) : (
                                <Package size={48} style={{ color: MUTED }} />
                            )}
                        </div>

                        {/* Gallery strip */}
                        {galleryImagesForDrawer.length > 1 && (
                            <div style={{ display: "flex", gap: "6px", overflowX: "auto" }}>
                                {galleryImagesForDrawer.map((src, idx) => (
                                    <div
                                        key={idx}
                                        onClick={() => setDrawerImg(idx)}
                                        style={{ width: "52px", height: "52px", borderRadius: "8px", overflow: "hidden", cursor: "pointer", border: `2px solid ${drawerImg === idx ? TEAL : BORDER}` }}
                                    >
                                        <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                                    </div>
                                ))}
                            </div>
                        )}

                        <div>
                            <h3 style={{ fontSize: "17px", fontWeight: 800, color: INK, margin: 0 }}>{displayedProduct.title}</h3>
                            <p style={{ fontFamily: MONO, fontSize: "11px", color: MUTED, margin: "2px 0 0" }}>SKU: {displayedProduct.sku || "—"}</p>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", background: "#FAF8F5", padding: "14px", borderRadius: "12px", border: `1px solid ${BORDER}` }}>
                            <div>
                                <span style={{ fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>Price</span>
                                <div style={{ fontSize: "16px", fontWeight: 800, color: TEAL }}>{money(displayedProduct.price)}</div>
                            </div>
                            <div>
                                <span style={{ fontSize: "10px", fontWeight: 700, color: MUTED, textTransform: "uppercase" }}>Stock</span>
                                <div style={{ fontSize: "16px", fontWeight: 800, color: INK }}>{displayedProduct.stock} units</div>
                            </div>
                        </div>

                        {displayedProduct.shortDescription && (
                            <div>
                                <h4 style={{ fontSize: "11px", fontWeight: 700, color: MUTED, textTransform: "uppercase", margin: "0 0 4px" }}>Short Description</h4>
                                <p style={{ fontSize: "13px", color: INK, margin: 0 }}>{displayedProduct.shortDescription}</p>
                            </div>
                        )}

                        {displayedProduct.description && (
                            <div>
                                <h4 style={{ fontSize: "11px", fontWeight: 700, color: MUTED, textTransform: "uppercase", margin: "0 0 4px" }}>Full Description</h4>
                                <p style={{ fontSize: "12px", color: MUTED, margin: 0, lineHeight: 1.5 }}>{displayedProduct.description}</p>
                            </div>
                        )}

                        <div style={{ display: "flex", gap: "8px", marginTop: "8px" }}>
                            <button
                                onClick={() => { closeDrawer(); navigate(`/admin/edit-product/${displayedProduct.id}`) }}
                                style={{ flex: 1, height: "40px", borderRadius: "10px", background: TEAL, color: WHITE, fontWeight: 700, fontSize: "12px", border: "none", cursor: "pointer" }}
                            >
                                Edit Product
                            </button>
                        </div>
                    </div>
                )}
            </RightDrawer>
        </div>
    )
}

export default AddProductPage