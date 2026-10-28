import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { useSelector } from "react-redux"
import Papa from "papaparse"
import {
  AlertCircle, AlertTriangle, CheckCircle2, Download, FileArchive, FileSpreadsheet, Info, Loader2, Package, UploadCloud, X,
} from "lucide-react"
import { toast } from "react-toastify"
import { supabase } from "../../context/SupabaseConfig"
import { readXlsx, XlsxError } from "./xlsxReader"
import { readImageArchive, readLooseImages } from "./imageArchive"
import { validateImport, describeIssue } from "./validate"
import { createImportRunner, fingerprint, ImportError } from "./importService"
import { buildReport, reportToCsv, reportToJson, reportToXlsx } from "./report"
import { buildTemplateWorkbook } from "./templateBuilder"
import { keyOf } from "./normalize"
import { formatINR, policyLine } from "../products/purchaseOptions"

// Admin ▸ Add Product ▸ "Bulk upload (Excel + images ZIP)".
// Workflow (BULK_UPLOAD_TEMPLATE_GUIDE §3.5): download the official template → fill it → pick the workbook and ONE zip of the images →
// "Check files" (parse + validate, no network write) → review the preview → "Import" → report.
// Nothing is imported unless EVERY row is valid; the database re-checks (stage = dry run) and creates all products in one transaction.
// All logic lives in the pure modules next to this file (unit-tested); this component only wires them to the page.

const C = {
  ink: "var(--color-ink)", body: "var(--color-body)", muted: "var(--color-muted)", border: "var(--color-border)", surface: "var(--color-surface)",
  soft: "var(--color-surface-muted)", primary: "var(--color-primary)", ok: "var(--color-success)", okBg: "var(--color-success-subtle)",
  err: "var(--color-error)", errBg: "var(--color-error-subtle)", warn: "var(--color-accent-strong)", warnBg: "var(--color-accent-subtle)",
}
const btn = { height: 40, padding: "0 16px", borderRadius: 10, border: `1px solid ${C.border}`, background: C.surface, color: C.ink, fontWeight: 600, fontSize: 14, cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 8 }
const btnPrimary = { ...btn, background: C.primary, color: "var(--color-inverse)", border: "none" }
const card = { border: `1px solid ${C.border}`, borderRadius: 12, padding: 16, background: C.surface }

const downloadBytes = (name, bytes, mime) => {
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }))
  const a = document.createElement("a")
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

/** workbook or CSV -> the 2-D array of cells the validator reads (the `Products` sheet, or the first visible one) */
async function readCells(file, bytes) {
  if (/\.csv$/i.test(file.name)) {
    const parsed = Papa.parse(new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, ""), { skipEmptyLines: false })
    return parsed.data
  }
  const wb = await readXlsx(bytes)
  const sheet = wb.sheets.find((s) => s.name.toLowerCase() === "products") || wb.sheets.find((s) => s.state === "visible") || wb.sheets[0]
  return sheet.rows
}

const friendly = (e) => (e instanceof XlsxError || e instanceof ImportError ? e.message : `Unexpected problem: ${e?.message || e}`)

function Stat({ label, value, tone }) {
  const color = tone === "bad" ? C.err : tone === "warn" ? C.warn : C.ink
  return (
    <div style={{ ...card, padding: "10px 14px", minWidth: 110 }}>
      <div style={{ fontSize: 22, fontWeight: 800, color }}>{value}</div>
      <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: 0.5, color: C.muted, fontWeight: 700 }}>{label}</div>
    </div>
  )
}

function FilePick({ icon: Icon, title, hint, accept, multiple, name, onFiles }) {
  return (
    <label style={{ ...card, textAlign: "left", cursor: "pointer", display: "flex", gap: 12, alignItems: "center", width: "100%", boxSizing: "border-box" }}>
      <Icon size={28} color={C.primary} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontWeight: 700, color: C.ink }}>{title}</span>
        <span style={{ display: "block", fontSize: 12, color: C.muted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name || hint}</span>
      </span>
      <input type="file" accept={accept} multiple={multiple} style={{ display: "none" }} onChange={(e) => { onFiles(Array.from(e.target.files || [])); e.target.value = "" }} />
    </label>
  )
}
function IssueTable({ issues, filter }) {
  const shown = issues.filter((i) => filter === "all" || i.severity === filter).slice(0, 300)
  if (shown.length === 0) return <p style={{ color: C.muted, fontSize: 13 }}>Nothing to show here.</p>
  const tone = { error: [C.errBg, C.err], warning: [C.warnBg, C.warn], info: [C.soft, C.body] }
  return (
    <div style={{ maxHeight: 280, overflow: "auto", border: `1px solid ${C.border}`, borderRadius: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
        <thead><tr style={{ background: C.soft, textAlign: "left" }}>{["", "Row", "Column", "Import ID", "Code", "Message"].map((h) => <th key={h} style={{ padding: "6px 8px", position: "sticky", top: 0, background: C.soft }}>{h}</th>)}</tr></thead>
        <tbody>
          {shown.map((i, n) => (
            <tr key={n} style={{ borderTop: `1px solid ${C.border}`, background: tone[i.severity][0] }} title={describeIssue(i)}>
              <td style={{ padding: "5px 8px", color: tone[i.severity][1], fontWeight: 800 }}>{i.severity === "error" ? "✕" : i.severity === "warning" ? "!" : "i"}</td>
              <td style={{ padding: "5px 8px" }}>{i.row || "file"}</td><td style={{ padding: "5px 8px" }}>{i.column}</td>
              <td style={{ padding: "5px 8px", fontFamily: "monospace" }}>{i.importId}</td><td style={{ padding: "5px 8px", fontWeight: 700 }}>{i.code}</td>
              <td style={{ padding: "5px 8px" }}>{i.message}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {issues.length > shown.length && <div style={{ padding: 8, fontSize: 12, color: C.muted }}>… and {issues.length - shown.length} more (fix these first, then check again).</div>}
    </div>
  )
}

function Preview({ groups, thumbs }) {
  const [limit, setLimit] = useState(30)
  // a blank cell (key absent) = the store default, resolved by the database when the product is created
  const side = (kind, enabled, days) => (enabled === undefined ? `${kind === "return" ? "returns" : "exchange"}: store default` : policyLine(kind, { enabled: enabled !== false && days != null, days }))
  const policy = (p) => `${side("return", p.return_enabled, p.return_window_days)} · ${side("exchange", p.exchange_enabled, p.exchange_window_days)}`
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {groups.slice(0, limit).map((g) => {
        const p = g.product
        const thumb = thumbs.get(keyOf(g.images.main))
        return (
          <div key={g.import_key} style={{ ...card, padding: 12, borderColor: g.hasErrors ? C.err : C.border }}>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ width: 48, height: 48, borderRadius: 8, background: C.soft, overflow: "hidden", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                {thumb ? <img src={thumb} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <Package size={20} color={C.muted} />}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 700, color: C.ink }}>{p.title || "(no name)"} <span style={{ fontSize: 11, color: C.muted, fontWeight: 600 }}>· {g.kind === "parent" ? "main product with variants" : "single product"} · row {g.row}</span></div>
                <div style={{ fontSize: 12, color: C.body, fontFamily: "monospace" }}>{g.import_key} · SKU {p.sku || "—"} · {p.category}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{policy(p)}{p.track_inventory === false ? " · stock not tracked" : ""}{p.status === "draft" ? " · DRAFT" : ""}</div>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontWeight: 800, color: C.ink }}>{p.main_option_enabled === false ? "main not sold" : formatINR(p.price)}</div>
                <div style={{ fontSize: 12, color: C.muted }}>{p.track_inventory === false ? "unlimited" : `${p.stock ?? 0} in stock`}</div>
              </div>
            </div>
            {g.variants.length > 0 && (
              <table style={{ width: "100%", marginTop: 8, borderCollapse: "collapse", fontSize: 12.5 }}>
                <tbody>
                  {g.variants.map((v) => (
                    <tr key={v.import_key} style={{ borderTop: `1px solid ${C.border}` }}>
                      <td style={{ padding: "4px 6px 4px 60px" }}>↳ <b>{v.name}</b> <span style={{ color: C.muted }}>{Object.entries(v.attributes || {}).map(([a, b]) => `${a}: ${b}`).join(", ")}</span></td>
                      <td style={{ fontFamily: "monospace", color: C.body }}>{v.sku}</td>
                      <td style={{ textAlign: "right", fontWeight: 700 }}>{formatINR(v.price)}</td>
                      <td style={{ textAlign: "right", color: C.muted, paddingRight: 6 }}>{v.track_inventory === false ? "unlimited" : `${v.stock ?? 0} in stock`}{v.status === "inactive" ? " · inactive" : ""}{"return_enabled" in v || "exchange_enabled" in v ? " · own policy" : ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )
      })}
      {groups.length > limit && <button type="button" style={btn} onClick={() => setLimit((n) => n + 50)}>Show 50 more ({groups.length - limit} hidden)</button>}
    </div>
  )
}

export default function BulkProductImport({ open, onClose, onImported }) {
  const user = useSelector((s) => s.user.user)
  const [workbook, setWorkbook] = useState(null)        // File
  const [zip, setZip] = useState(null)                  // File
  const [loose, setLoose] = useState([])                // File[]
  const [check, setCheck] = useState(null)              // { validation, images, fileHash, thumbs }
  const [busy, setBusy] = useState("")                  // "" | "checking" | "importing"
  const [progress, setProgress] = useState(null)
  const [result, setResult] = useState(null)            // { ok, report, issues, ... }
  const [error, setError] = useState("")
  const [filter, setFilter] = useState("error")
  const [categories, setCategories] = useState([])
  const [stale, setStale] = useState([])
  const runner = useMemo(() => createImportRunner(supabase), [])

  // revoke the preview thumbnails when they are replaced / the dialog closes
  const thumbsRef = useRef(new Map())
  const freeThumbs = useCallback(() => { for (const u of thumbsRef.current.values()) URL.revokeObjectURL(u); thumbsRef.current = new Map() }, [])
  useEffect(() => freeThumbs, [freeThumbs])

  const loadStale = useCallback(async () => {
    const { data } = await supabase.from("import_batches").select("id, file_name, created_at, summary").eq("status", "staged").order("created_at", { ascending: true }).limit(20)
    setStale(data || [])
  }, [])
  useEffect(() => {
    if (!open) return
    let active = true
    ;(async () => {
      const [{ data: rows }] = await Promise.all([supabase.from("products").select("category"), loadStale()])
      if (active) setCategories([...new Set((rows || []).map((r) => String(r.category || "").trim()).filter(Boolean))].sort())
    })()
    return () => { active = false }
  }, [open, loadStale])

  const reset = () => { freeThumbs(); setCheck(null); setResult(null); setError(""); setProgress(null) }

  const runCheck = async () => {
    if (!workbook) { setError("Choose the filled-in Excel (or CSV) file first."); return }
    reset(); setBusy("checking")
    try {
      const wbBytes = new Uint8Array(await workbook.arrayBuffer())
      const cells2d = await readCells(workbook, wbBytes)
      let images = null
      if (zip) images = await readImageArchive(await zip.arrayBuffer())
      else if (loose.length) images = await readLooseImages(loose)
      if (images?.fatal) { setError(images.fatal.message); return }
      const validation = validateImport({ cells2d, imageFiles: images ? images.files : null })
      const referenced = validation.imageRefs.filter((r) => r.kind === "file").map((r) => ({ name: r.ref, bytes: images?.bytes.get(keyOf(r.ref)) })).filter((x) => x.bytes)
      const fileHash = await fingerprint({ workbookBytes: wbBytes, referencedImages: referenced })
      const thumbs = new Map()
      for (const g of validation.groups) {
        const k = keyOf(g.images.main)
        const bytes = k && images?.bytes.get(k)
        if (bytes && !thumbs.has(k)) thumbs.set(k, URL.createObjectURL(new Blob([bytes])))
      }
      thumbsRef.current = thumbs
      setCheck({ validation, images, fileHash, thumbs })
      setFilter(validation.counts.errors ? "error" : "warning")
    } catch (e) {
      setError(friendly(e))
    } finally { setBusy("") }
  }

  const startImport = async () => {
    const v = check?.validation
    if (!v?.ok) return
    const msg = `Create ${v.summary.products} product(s) and ${v.summary.variants} variant(s)?\n\nEverything is created in ONE step — if anything fails, nothing is created. Re-uploading the same files later will not duplicate anything.`
    if (!window.confirm(msg)) return
    setBusy("importing"); setError(""); setResult(null)
    const startedAt = new Date()
    try {
      const outcome = await runner.run({
        fileHash: check.fileHash, fileName: workbook.name, groups: v.groups, sourceBytes: check.images?.bytes || new Map(), onProgress: setProgress,
      })
      const report = buildReport({ fileName: workbook.name, fileHash: check.fileHash, operator: user?.email || "", startedAt, finishedAt: new Date(), validation: v, stage: outcome.stage, commit: outcome.commit })
      setResult({ ...outcome, report })
      if (outcome.ok && !outcome.nothingToDo) { toast.success("Products imported"); onImported?.() }
      else if (!outcome.ok) setError(outcome.message || "The server refused the import — see the messages below. Nothing was imported.")
      loadStale()
    } catch (e) {
      setError(friendly(e))
      loadStale()
    } finally { setBusy(""); setProgress(null) }
  }

  const cancelStale = async (id) => {
    try { await runner.cancel(id); toast.success("Staged import cancelled and its files removed"); loadStale() } catch (e) { toast.error(friendly(e)) }
  }

  const downloadMyTemplate = async () => downloadBytes("product-import-template.xlsx", await buildTemplateWorkbook({ categories }), XLSX_MIME)
  const downloadReport = async (kind) => {
    if (!result?.report) return
    if (kind === "xlsx") downloadBytes("import-report.xlsx", await reportToXlsx(result.report, check?.validation.issues || []), XLSX_MIME)
    else if (kind === "csv") downloadBytes("import-report.csv", new TextEncoder().encode(reportToCsv(result.report)), "text/csv")
    else downloadBytes("import-report.json", new TextEncoder().encode(reportToJson(result.report)), "application/json")
  }

  if (!open) return null
  const v = check?.validation
  const issues = v ? v.issues : []
  const serverErrors = result?.errors || []
  // Rendered into <body>: the Add Product cards are animated with GSAP and keep a CSS transform afterwards, and a transformed
  // ancestor becomes the containing block of `position: fixed` - in place, this window was squeezed into the 185 px card.
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label="Bulk product upload" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,0.45)", display: "flex", alignItems: "flex-start", justifyContent: "center", overflow: "auto", padding: "24px 12px" }}>
      <div style={{ background: C.surface, borderRadius: 16, width: "100%", maxWidth: 1000, padding: 24, display: "flex", flexDirection: "column", gap: 18 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <h2 style={{ fontSize: 22, fontWeight: 800, color: C.ink, margin: 0 }}>Bulk product upload — Excel + images ZIP</h2>
          <button type="button" aria-label="Close" onClick={() => { reset(); onClose?.() }} style={{ ...btn, padding: 0, width: 40, justifyContent: "center" }}><X size={18} /></button>
        </div>

        {/* 1 — files */}
        <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <a href="/templates/product-import-template.xlsx" download style={{ ...btn, textDecoration: "none" }}><Download size={16} /> Official template</a>
            <button type="button" style={btn} onClick={downloadMyTemplate} title="The same template with a dropdown of your current categories"><Download size={16} /> Template with my categories</button>
            <a href="/templates/demo/products-demo.xlsx" download style={{ ...btn, textDecoration: "none" }}><Download size={16} /> Demo workbook</a>
            <a href="/templates/demo/images-demo.zip" download style={{ ...btn, textDecoration: "none" }}><Download size={16} /> Demo images (ZIP)</a>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
            <FilePick icon={FileSpreadsheet} title="1. Filled-in workbook" hint="Excel .xlsx (or an old-style .csv)" accept=".xlsx,.csv" name={workbook?.name} onFiles={(f) => { setWorkbook(f[0] || null); reset() }} />
            <FilePick icon={FileArchive} title="2. Images ZIP" hint="One .zip with every picture named in the sheet" accept=".zip" name={zip?.name} onFiles={(f) => { setZip(f[0] || null); setLoose([]); reset() }} />
          </div>
          <div style={{ fontSize: 12, color: C.muted }}>
            No ZIP? <label style={{ color: C.primary, fontWeight: 700, cursor: "pointer" }}>pick the image files one by one<input type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple style={{ display: "none" }} onChange={(e) => { setLoose(Array.from(e.target.files || [])); setZip(null); reset(); e.target.value = "" }} /></label>
            {loose.length > 0 && <> — {loose.length} image file(s) selected</>}. Pictures are matched to products by their EXACT file name (never by order).
          </div>
          <div><button type="button" style={btnPrimary} onClick={runCheck} disabled={!!busy}>{busy === "checking" ? <><Loader2 size={16} className="animate-spin" /> Checking…</> : <><UploadCloud size={16} /> Check files</>}</button></div>
        </section>

        {error && <div role="alert" style={{ ...card, background: C.errBg, borderColor: C.err, color: C.err, display: "flex", gap: 8, whiteSpace: "pre-line" }}><AlertCircle size={18} style={{ flexShrink: 0 }} /> {error}</div>}

        {/* 2 — result of the check */}
        {v && (
          <section style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Stat label="Rows" value={v.summary.rows} /><Stat label="Products" value={v.summary.products} /><Stat label="Variants" value={v.summary.variants} /><Stat label="Images" value={v.summary.images + v.summary.imageUrls} />
              <Stat label="Errors" value={v.counts.errors} tone={v.counts.errors ? "bad" : undefined} /><Stat label="Warnings" value={v.counts.warnings} tone={v.counts.warnings ? "warn" : undefined} />
            </div>
            {v.ok ? (
              <div style={{ ...card, background: C.okBg, borderColor: C.ok, color: C.ok, display: "flex", gap: 8, alignItems: "center" }}><CheckCircle2 size={18} /> The file is valid. Review the preview below, then import.</div>
            ) : (
              <div style={{ ...card, background: C.errBg, borderColor: C.err, color: C.err, display: "flex", gap: 8, alignItems: "center" }}><AlertTriangle size={18} /> {v.counts.errors} problem(s) must be fixed in the file. Nothing is imported until every row is valid — fix them in Excel and press “Check files” again.</div>
            )}
            {issues.length > 0 && (
              <div>
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  {[["error", `Errors (${v.counts.errors})`], ["warning", `Warnings (${v.counts.warnings})`], ["info", `Info (${v.counts.infos})`], ["all", "All"]].map(([k, label]) => (
                    <button key={k} type="button" onClick={() => setFilter(k)} style={{ ...btn, height: 32, fontSize: 12.5, background: filter === k ? C.soft : C.surface, borderColor: filter === k ? C.primary : C.border }}>{label}</button>
                  ))}
                </div>
                <IssueTable issues={issues} filter={filter} />
              </div>
            )}
            {v.groups.length > 0 && (<div><h3 style={{ margin: "4px 0 8px", fontSize: 15, color: C.ink }}>Preview — what would be created</h3><Preview groups={v.groups} thumbs={check.thumbs} /></div>)}
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button type="button" style={{ ...btnPrimary, opacity: v.ok && !busy ? 1 : 0.5, cursor: v.ok && !busy ? "pointer" : "not-allowed" }} disabled={!v.ok || !!busy} onClick={startImport}>
                {busy === "importing" ? <><Loader2 size={16} className="animate-spin" /> Importing…</> : `Import ${v.summary.products} product(s)`}
              </button>
              {progress && <span style={{ fontSize: 13, color: C.body }}>{progress.phase === "upload" ? `Uploading images ${progress.done}/${progress.total}…` : progress.label}</span>}
            </div>
          </section>
        )}

        {/* 3 — outcome */}
        {result && (
          <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {serverErrors.length > 0 && (
              <div style={{ ...card, background: C.errBg, borderColor: C.err }}>
                <b style={{ color: C.err }}>The store refused this file — nothing was imported:</b>
                <ul style={{ margin: "6px 0 0 18px", fontSize: 13 }}>{serverErrors.slice(0, 50).map((e, i) => <li key={i}><b>{e.import_key || "file"}</b> (row {e.row || "?"}) {e.code}: {e.message}</li>)}</ul>
              </div>
            )}
            {result.ok && (
              <div style={{ ...card, background: C.okBg, borderColor: C.ok, color: C.ok, display: "flex", gap: 8 }}>
                <CheckCircle2 size={18} />
                {result.nothingToDo ? "Everything in this file was imported before and is unchanged — nothing to do."
                  : result.commit?.already ? "These files were already imported — nothing was repeated."
                    : `Imported ${result.commit?.summary?.created_products ?? 0} product(s) and ${result.commit?.summary?.created_variants ?? 0} variant(s).`}
              </div>
            )}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" style={btn} onClick={() => downloadReport("xlsx")}><Download size={16} /> Report (.xlsx)</button>
              <button type="button" style={btn} onClick={() => downloadReport("csv")}><Download size={16} /> .csv</button>
              <button type="button" style={btn} onClick={() => downloadReport("json")}><Download size={16} /> .json</button>
            </div>
          </section>
        )}

        {/* 4 — leftovers of earlier attempts */}
        {stale.length > 0 && (
          <section style={{ ...card, background: C.soft }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontWeight: 700, color: C.ink }}><Info size={16} /> Unfinished imports</div>
            <p style={{ fontSize: 12.5, color: C.body, margin: "4px 0 8px" }}>These were checked but never completed (for example the browser was closed during the upload). Run the same files again to finish them, or cancel to delete their uploaded pictures.</p>
            {stale.map((b) => (
              <div key={b.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 13 }}>
                <span>{b.file_name || "import"} · {b.summary?.products ?? "?"} product(s) · {new Date(b.created_at).toLocaleString("en-IN")}</span>
                <button type="button" style={{ ...btn, height: 30, fontSize: 12 }} onClick={() => cancelStale(b.id)} disabled={!!busy}>Cancel &amp; clean up</button>
              </div>
            ))}
          </section>
        )}
      </div>
    </div>,
    document.body,
  )
}