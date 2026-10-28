/**
 * ThemeSwitcher — a minimal, drop-in control for changing theme + mode at
 * runtime. Purely optional; the theming works without it (via useTheme()).
 * Drop it anywhere, e.g. in the header or a settings page:
 *
 *   import ThemeSwitcher from "@/theme/ThemeSwitcher";
 *   <ThemeSwitcher />
 *
 * It is styled entirely with the semantic tokens, so it themes itself.
 */
import { useTheme } from "./ThemeContext.jsx";
import { THEME_LIST } from "./themes.js";

export default function ThemeSwitcher({ className = "" }) {
  const { theme, mode, setTheme, toggleMode } = useTheme();

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <select
        aria-label="Theme"
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink"
      >
        {THEME_LIST.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>

      <button
        type="button"
        aria-label="Toggle light/dark mode"
        onClick={toggleMode}
        className="rounded-md border border-border bg-surface px-2 py-1 text-sm text-ink hover:bg-surface-muted"
      >
        {mode === "dark" ? "🌙 Dark" : "☀️ Light"}
      </button>
    </div>
  );
}