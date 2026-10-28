import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react"

/**
 * Build a compact page-number list with ellipsis (max 5 numbers shown).
 * @param {number} page
 * @param {number} totalPages
 * @returns {(number|"…")[]}
 */
const buildPages = (page, totalPages) => {
    if (totalPages <= 5) return Array.from({ length: totalPages }, (_, i) => i + 1)
    let start = Math.max(1, page - 2)
    let end = Math.min(totalPages, start + 4)
    start = Math.max(1, end - 4)
    const pages = []
    if (start > 1) { pages.push(1); if (start > 2) pages.push("…") }
    for (let p = start; p <= end; p++) pages.push(p)
    if (end < totalPages) { if (end < totalPages - 1) pages.push("…"); pages.push(totalPages) }
    return pages
}

/**
 * Pagination control: "Showing X–Y of Z", page-size selector, and
 * First | Prev | numbers(ellipsis) | Next | Last.
 *
 * @param {Object} props
 * @param {number} props.total
 * @param {number} props.page
 * @param {number} props.pageSize
 * @param {(p:number)=>void} props.onPageChange
 * @param {(s:number)=>void} [props.onPageSizeChange]
 * @param {number[]} [props.pageSizeOptions=[10,25,50]]
 * @param {string}  [props.accent="var(--color-primary)"]
 */
export default function Pagination({
    total,
    page,
    pageSize,
    onPageChange,
    onPageSizeChange,
    pageSizeOptions = [10, 25, 50],
    accent = "var(--color-primary)",
    itemLabel = "orders",
}) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize))
    const from = total === 0 ? 0 : (page - 1) * pageSize + 1
    const to = Math.min(page * pageSize, total)
    const pages = buildPages(page, totalPages)
    const go = (p) => onPageChange(Math.min(totalPages, Math.max(1, p)))

    const btn = "min-w-[34px] h-[34px] px-2 flex items-center justify-center rounded-lg text-sm font-semibold"
    const border = { border: "1px solid color-mix(in srgb, var(--color-border) 60%, transparent)", color: "var(--color-body)" }
    const disabled = (cond) => ({ opacity: cond ? 0.4 : 1, cursor: cond ? "not-allowed" : "pointer" })

    return (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 mt-5">
            {/* Left: count + page size */}
            <div className="flex items-center gap-3 text-sm" style={{ color: "var(--color-body)" }}>
                <span>Showing <b>{from}</b>–<b>{to}</b> of <b>{total}</b> {itemLabel}</span>
                {onPageSizeChange && (
                    <label className="flex items-center gap-1.5">
                        <span className="hidden sm:inline">Per page:</span>
                        <select
                            value={pageSize}
                            onChange={(e) => onPageSizeChange(Number(e.target.value))}
                            className="rounded-lg px-2 py-1 outline-none"
                            style={border}
                        >
                            {pageSizeOptions.map((s) => <option key={s} value={s}>{s}</option>)}
                        </select>
                    </label>
                )}
            </div>

            {/* Right: controls */}
            <div className="flex items-center gap-1.5">
                <button className={btn} style={{ ...border, ...disabled(page === 1) }} disabled={page === 1} onClick={() => go(1)} aria-label="First page"><ChevronsLeft size={15} /></button>
                <button className={btn} style={{ ...border, ...disabled(page === 1) }} disabled={page === 1} onClick={() => go(page - 1)} aria-label="Previous page"><ChevronLeft size={15} /></button>
                {pages.map((p, i) =>
                    p === "…" ? (
                        <span key={`e${i}`} className="px-1" style={{ color: "var(--color-body)" }}>…</span>
                    ) : (
                        <button
                            key={p}
                            onClick={() => go(p)}
                            className={btn}
                            style={p === page ? { background: accent, color: "var(--color-inverse)" } : border}
                        >
                            {p}
                        </button>
                    )
                )}
                <button className={btn} style={{ ...border, ...disabled(page === totalPages) }} disabled={page === totalPages} onClick={() => go(page + 1)} aria-label="Next page"><ChevronRight size={15} /></button>
                <button className={btn} style={{ ...border, ...disabled(page === totalPages) }} disabled={page === totalPages} onClick={() => go(totalPages)} aria-label="Last page"><ChevronsRight size={15} /></button>
            </div>
        </div>
    )
}