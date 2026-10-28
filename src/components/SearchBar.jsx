import { useState, useEffect } from "react"
import { Search, X } from "lucide-react"

/**
 * Debounced search input with a clear (✕) button.
 *
 * @param {Object}   props
 * @param {string}   props.value                Committed search value (controlled).
 * @param {(v:string)=>void} props.onChange      Called with the debounced value.
 * @param {() => void} [props.onClear]            Called when cleared (optional).
 * @param {string}   [props.placeholder]
 * @param {number}   [props.debounceMs=300]
 * @param {string}   [props.className]
 */
export default function SearchBar({
  value,
  onChange,
  onClear,
  placeholder = "Search…",
  debounceMs = 300,
  className = "",
}) {
  const [text, setText] = useState(value || "")

  // Keep local text in sync when the value is reset externally.
  useEffect(() => { setText(value || "") }, [value])

  // Debounce keystrokes before committing upward.
  useEffect(() => {
    const t = setTimeout(() => {
      if (text !== value) onChange(text)
    }, debounceMs)
    return () => clearTimeout(t)
  }, [text]) // eslint-disable-line react-hooks/exhaustive-deps

  const clear = () => {
    setText("")
    onChange("")
    onClear?.()
  }

  return (
    <div className={`relative ${className}`}>
      <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: "var(--color-muted)" }} />
      <input
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="w-full outline-none rounded-full"
        style={{
          background: "var(--color-surface)",
          border: "1px solid color-mix(in srgb, var(--color-border) 60%, transparent)",
          padding: "10px 38px 10px 36px",
          fontSize: "14px",
          color: "var(--color-ink)",
        }}
      />
      {text && (
        <button
          onClick={clear}
          aria-label="Clear search"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 flex items-center justify-center rounded-full"
          style={{ width: "22px", height: "22px", background: "color-mix(in srgb, var(--color-ink) 12%, transparent)", color: "var(--color-body)" }}
        >
          <X size={13} />
        </button>
      )}
    </div>
  )
}