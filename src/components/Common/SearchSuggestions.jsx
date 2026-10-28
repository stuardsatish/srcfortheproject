import { Search, Clock, X, SlidersHorizontal } from "lucide-react"

/**
 * Autocomplete / recent-searches dropdown for the catalog search box
 * (roadmap task 2.2, web counterpart of the mobile
 * `components/SearchSuggestions.jsx`).
 *
 * Two modes, chosen by whether anything has been typed:
 *   - empty query → the user's own recent searches, each removable, plus a
 *     "Clear all". Renders nothing at all when there's no history, so the
 *     caller just shows no dropdown on a first visit.
 *   - non-empty query → matching categories first (they narrow the most), then
 *     product hits from `results` (server-side pg_trgm matches when the RPC is
 *     available, local substring matches otherwise).
 *
 * Positioning is the caller's job: this renders an absolutely-positioned panel
 * and expects to sit inside a `position: relative` wrapper around the input.
 */

const money = (n) => `₹${Number(n || 0).toFixed(2)}`

/**
 * The dropdown shell. Module-scope, not declared inside the component — a
 * component created during render is a fresh type on every keystroke, which
 * remounts (and so resets the scroll position of) the whole panel as the user
 * types.
 */
const Panel = ({ children }) => (
    <div
        className="absolute left-0 right-0 overflow-hidden"
        style={{
            top: "calc(100% + 6px)",
            zIndex: 60,
            maxHeight: "360px",
            overflowY: "auto",
            background: "var(--color-surface)",
            border: "1px solid color-mix(in srgb, var(--color-border) 50%, transparent)",
            borderRadius: "12px",
            boxShadow: "0 12px 32px -8px rgba(0,0,0,0.25)",
        }}
    >
        {children}
    </div>
)

const Row = ({ children, onClick, onMouseDown }) => (
    <button
        type="button"
        onClick={onClick}
        onMouseDown={onMouseDown}
        className="w-full flex items-center text-left hover:opacity-80 transition"
        style={{ gap: "12px", padding: "10px 14px", background: "transparent" }}
    >
        {children}
    </button>
)

const SearchSuggestions = ({
    query,
    results = [],
    categories = [],
    recentSearches = [],
    loading = false,
    onPickTerm,
    onPickProduct,
    onRemoveRecent,
    onClearRecents,
}) => {
    const needle = String(query || "").trim().toLowerCase()

    // `onMouseDown` + preventDefault, not onClick alone: the input's own blur
    // fires first on a plain click and would unmount this panel before the
    // click landed, so the suggestion would never be picked.
    const pick = (fn) => (e) => {
        e.preventDefault()
        fn()
    }

    // --- empty query: recent searches ---
    if (!needle) {
        if (!recentSearches.length) return null
        return (
            <Panel>
                <div className="flex items-center justify-between" style={{ padding: "10px 14px 4px" }}>
                    <span style={{ fontWeight: 600, fontSize: "10px", letterSpacing: "0.8px", textTransform: "uppercase", color: "var(--color-muted)" }}>
                        Recent Searches
                    </span>
                    <button
                        type="button"
                        onMouseDown={pick(onClearRecents)}
                        style={{ fontWeight: 600, fontSize: "11px", color: "var(--color-primary)" }}
                    >
                        Clear all
                    </button>
                </div>
                {recentSearches.map((term) => (
                    <div key={term} className="flex items-center">
                        <Row onMouseDown={pick(() => onPickTerm(term))}>
                            <Clock size={14} style={{ color: "var(--color-muted)", flexShrink: 0 }} />
                            <span style={{ fontSize: "14px", color: "var(--color-ink)" }}>{term}</span>
                        </Row>
                        <button
                            type="button"
                            onMouseDown={pick(() => onRemoveRecent(term))}
                            aria-label={`Remove ${term} from recent searches`}
                            style={{ padding: "10px 14px", color: "var(--color-muted)", flexShrink: 0 }}
                        >
                            <X size={13} />
                        </button>
                    </div>
                ))}
            </Panel>
        )
    }

    // --- typed query ---
    const categoryMatches = categories
        .filter((c) => String(c).toLowerCase().includes(needle))
        .slice(0, 3)

    if (loading && !results.length && !categoryMatches.length) {
        return (
            <Panel>
                <div style={{ padding: "14px", fontSize: "13px", color: "var(--color-muted)" }}>
                    Searching…
                </div>
            </Panel>
        )
    }

    if (!results.length && !categoryMatches.length) {
        return (
            <Panel>
                <div style={{ padding: "14px", fontSize: "13px", color: "var(--color-muted)" }}>
                    No matches for &ldquo;{String(query).trim()}&rdquo;
                </div>
            </Panel>
        )
    }

    return (
        <Panel>
            {categoryMatches.map((cat) => (
                <Row key={`cat-${cat}`} onMouseDown={pick(() => onPickTerm(cat))}>
                    <SlidersHorizontal size={14} style={{ color: "var(--color-muted)", flexShrink: 0 }} />
                    <span className="flex-1" style={{ fontSize: "14px", color: "var(--color-ink)" }}>{cat}</span>
                    <span style={{ fontSize: "11px", color: "var(--color-muted)" }}>Category</span>
                </Row>
            ))}
            {results.map((p) => {
                const name = p.title || p.name || "Product"
                const img = p.thumbnail || p.image || p.imageUrl
                return (
                    <Row key={`prod-${p.id}`} onMouseDown={pick(() => onPickProduct(p))}>
                        {img ? (
                            <img
                                src={img}
                                alt=""
                                style={{ width: "32px", height: "32px", borderRadius: "6px", objectFit: "cover", flexShrink: 0, background: "var(--color-surface-muted)" }}
                            />
                        ) : (
                            <Search size={14} style={{ color: "var(--color-muted)", flexShrink: 0 }} />
                        )}
                        <span className="flex-1 truncate" style={{ fontSize: "14px", color: "var(--color-ink)" }}>{name}</span>
                        <span style={{ fontSize: "12px", fontWeight: 600, color: "var(--color-body)", flexShrink: 0 }}>
                            {money(p.price)}
                        </span>
                    </Row>
                )
            })}
        </Panel>
    )
}

export default SearchSuggestions