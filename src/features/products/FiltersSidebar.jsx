import React from "react"
import { Search, Star, ChevronDown } from "lucide-react"

const labelStyle = {
  fontSize: "12px",
  fontWeight: 600,
  color: "var(--color-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.6px",
}

const FiltersSidebar = ({
  categories,
  selectedCategories,
  setSelectedCategories,
  setMinPrice,
  minPrice,
  maxPrice,
  setMinRating,
  setSort,
  clearFilters,
  search,
  setSearch,
}) => {

  const toggleCategory = (cat) => {
    if (selectedCategories.includes(cat)) {
      setSelectedCategories(selectedCategories.filter((c) => c !== cat))
    } else {
      setSelectedCategories([...selectedCategories, cat])
    }
  }

  return (
    <div className="select-none" style={{ fontFamily: "Inter, sans-serif" }}>
      <style>{`
        .filters-input:focus{border-color:var(--color-ink) !important;background:var(--color-surface) !important;}
        .filters-input::placeholder{color:var(--color-muted);}
      `}</style>

      {/* HEADER */}
      <div className="flex items-center justify-between" style={{ marginBottom: "20px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: 700, color: "var(--color-ink)" }}>Filters</h2>
        <button
          onClick={clearFilters}
          style={{ fontSize: "13px", fontWeight: 600, color: "var(--color-primary)" }}
        >
          Reset
        </button>
      </div>

      <div className="flex flex-col" style={{ gap: "24px" }}>

        {/* SEARCH */}
        <div className="relative">
          <Search
            size={16}
            style={{ position: "absolute", left: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--color-muted)", pointerEvents: "none" }}
          />
          <input
            type="text"
            placeholder="Search products..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full outline-none filters-input"
            style={{ background: "var(--color-surface-muted)", borderRadius: "12px", height: "44px", padding: "0 16px 0 40px", fontSize: "14px", color: "var(--color-ink)", border: "1px solid transparent" }}
          />
        </div>

        {/* CATEGORY */}
        <div>
          <h3 style={{ ...labelStyle, marginBottom: "12px" }}>Category</h3>
          <div className="flex flex-wrap" style={{ gap: "8px" }}>
            {categories.map((cat) => {
              const active = selectedCategories.includes(cat)
              return (
                <button
                  key={cat}
                  onClick={() => toggleCategory(cat)}
                  style={{
                    padding: "8px 14px",
                    borderRadius: "9999px",
                    fontSize: "13px",
                    fontWeight: 600,
                    textTransform: "capitalize",
                    border: active ? "1px solid var(--color-primary)" : "1px solid var(--color-border)",
                    background: active ? "var(--color-primary)" : "var(--color-surface)",
                    color: active ? "var(--color-inverse)" : "var(--color-body)",
                    transition: "all 0.15s",
                  }}
                >
                  {cat}
                </button>
              )
            })}
          </div>
        </div>

        {/* PRICE */}
        <div>
          <div className="flex items-center justify-between" style={{ marginBottom: "10px" }}>
            <h3 style={labelStyle}>Min Price</h3>
            <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--color-ink)" }}>
              ₹{Number(minPrice).toLocaleString()}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max={maxPrice}
            step="1"
            value={minPrice}
            onChange={(e) => setMinPrice(Number(e.target.value))}
            className="w-full"
            style={{ accentColor: "var(--color-primary)", cursor: "pointer" }}
          />
          <div className="flex items-center justify-between" style={{ marginTop: "6px" }}>
            <span style={{ fontSize: "11px", color: "var(--color-muted)" }}>₹0</span>
            <span style={{ fontSize: "11px", color: "var(--color-muted)" }}>₹{Number(maxPrice).toLocaleString()}</span>
          </div>
        </div>

        {/* RATING */}
        <div>
          <h3 style={{ ...labelStyle, marginBottom: "12px" }}>Rating</h3>
          <div className="flex flex-col" style={{ gap: "10px" }}>
            {[4, 3, 2].map((r) => (
              <label key={r} className="flex items-center cursor-pointer" style={{ gap: "8px" }}>
                <input
                  type="radio"
                  name="rating"
                  onChange={() => setMinRating(r)}
                  style={{ accentColor: "var(--color-primary)", width: "16px", height: "16px", cursor: "pointer" }}
                />
                <span className="flex items-center" style={{ gap: "2px" }}>
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Star key={i} size={14} style={{ fill: i < r ? "var(--color-chart-gold)" : "none", color: i < r ? "var(--color-chart-gold)" : "var(--color-border-strong)" }} />
                  ))}
                </span>
                <span style={{ fontSize: "13px", fontWeight: 500, color: "var(--color-body)" }}>&amp; Up</span>
              </label>
            ))}
          </div>
        </div>

        {/* SORT */}
        <div>
          <h3 style={{ ...labelStyle, marginBottom: "12px" }}>Sort By</h3>
          <div className="relative">
            <select
              onChange={(e) => setSort(e.target.value)}
              className="w-full outline-none"
              style={{ background: "var(--color-surface-muted)", borderRadius: "12px", height: "44px", padding: "0 40px 0 16px", fontSize: "14px", fontWeight: 500, color: "var(--color-ink)", border: "1px solid transparent", appearance: "none", WebkitAppearance: "none", cursor: "pointer" }}
            >
              <option value="">Featured</option>
              <option value="priceLow">Price: Low to High</option>
              <option value="priceHigh">Price: High to Low</option>
              <option value="rating">Top Rated</option>
            </select>
            <ChevronDown
              size={16}
              style={{ position: "absolute", right: "14px", top: "50%", transform: "translateY(-50%)", color: "var(--color-muted)", pointerEvents: "none" }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

export default FiltersSidebar