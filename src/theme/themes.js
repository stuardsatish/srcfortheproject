/**
 * ─────────────────────────────────────────────────────────────────────────
 *  CENTRAL THEME CONFIG — single source of truth for every color in the app
 * ─────────────────────────────────────────────────────────────────────────
 *
 *  This file holds ALL theme + mode color definitions. Nothing else in the
 *  codebase should contain a raw hex/rgb value for a themable color — every
 *  component uses a SEMANTIC Tailwind class (bg-primary, text-error, …) that
 *  resolves to a CSS variable, and those variables are set from THIS file at
 *  runtime by the ThemeProvider (see ./ThemeContext.jsx).
 *
 *  HOW IT FITS TOGETHER
 *  --------------------
 *   1. `TOKENS`  — the list of semantic color tokens (names + descriptions).
 *   2. `themes`  — the value of each token, per theme, per mode (light/dark).
 *   3. index.css `@theme` — maps each token to a Tailwind color utility,
 *                           e.g. `--color-primary` → `.bg-primary`, `.text-primary`.
 *   4. ThemeProvider — injects `:root[data-theme=..][data-mode=..]{ … }` CSS
 *                      blocks generated from `themes`, and toggles the
 *                      data-theme / data-mode attributes on <html>.
 *
 *  ── HOW TO … ──────────────────────────────────────────────────────────────
 *  a) CHANGE an existing theme's colors → edit the hex values below. Done.
 *  b) ADD a new theme → copy a whole theme block (e.g. `'brand-a'`), rename
 *     the key, tweak the hexes for `light` and `dark`. It becomes selectable
 *     immediately via useTheme().setTheme('your-name'). Add it to THEME_LIST
 *     if you want it to appear in the theme switcher.
 *  c) ADD a new semantic token → (1) add it to `TOKENS`, (2) add a value for
 *     it in EVERY theme/mode below, (3) add a matching
 *     `--color-<token>: var(--color-<token>);`… actually just add
 *     `--color-<token>` to the `@theme` block in src/index.css so Tailwind
 *     generates the `bg-/text-/border-<token>` utilities. See src/theme/README.md.
 *
 *  NOTE: `white`, `black`, `transparent`, `current` remain Tailwind built-ins
 *  and are intentionally NOT themed. Use `surface` / `text-inverse` / etc. for
 *  anything that must flip between light and dark.
 */

/**
 * Every semantic color token, with the real-world purpose it was derived from
 * during the codebase audit. Order here drives the order of generated CSS.
 */
export const TOKENS = [
  // ── Interactive / brand ────────────────────────────────────────────────
  ["primary", "Primary brand accent: buttons, prices, active state, links"],
  ["primary-hover", "Primary hover / pressed"],
  ["primary-fg", "Text/icon rendered ON a primary-colored surface"],
  ["accent", "Secondary accent: ratings, badges, focus rings, selected"],
  ["accent-strong", "Darker accent, mainly for accent-colored text"],
  ["accent-subtle", "Faint accent tint for backgrounds/pills"],
  ["accent-fg", "Text/icon rendered ON an accent-colored surface"],
  ["link", "Hyperlink text"],
  ["link-hover", "Hyperlink hover"],
  ["ring", "Focus ring color"],
  ["disabled", "Disabled control background"],
  ["disabled-fg", "Disabled control text/icon"],

  // ── Surfaces ────────────────────────────────────────────────────────────
  ["background", "App page background"],
  ["surface", "Cards, sheets, raised panels (was bg-white)"],
  ["surface-muted", "Subtle surfaces, inputs, hover fills (was gray-50/tint)"],
  ["surface-inverse", "High-contrast dark surface inside a light page"],
  ["overlay", "Modal/drawer backdrop scrim"],

  // ── Text ──────────────────────────────────────────────────────────────
  ["ink", "Headings / strongest text (was ink / neutral-800/900)"],
  ["body", "Body copy (was body / neutral-600/700)"],
  ["muted", "Captions, secondary labels (was muted / neutral-400/500)"],
  ["inverse", "Text on dark/primary surfaces (was text-white)"],

  // ── Borders ─────────────────────────────────────────────────────────────
  ["border", "Default borders / dividers (was line / neutral-200)"],
  ["border-strong", "Stronger borders (was neutral-300)"],
  ["border-subtle", "Faintest hairline borders (was neutral-100)"],

  // ── Status: success ──────────────────────────────────────────────────────
  ["success", "Success text/icon/solid"],
  ["success-fg", "Text on a solid success surface"],
  ["success-subtle", "Success background tint"],
  ["success-border", "Success border"],

  // ── Status: error / destructive ───────────────────────────────────────────
  ["error", "Error/destructive text/icon/solid"],
  ["error-fg", "Text on a solid error surface"],
  ["error-subtle", "Error background tint"],
  ["error-border", "Error border"],

  // ── Status: warning ────────────────────────────────────────────────────────
  ["warning", "Warning text/icon/solid"],
  ["warning-fg", "Text on a solid warning surface"],
  ["warning-subtle", "Warning background tint"],
  ["warning-border", "Warning border"],

  // ── Status: info ──────────────────────────────────────────────────────────
  ["info", "Info text/icon/solid"],
  ["info-fg", "Text on a solid info surface"],
  ["info-subtle", "Info background tint"],
  ["info-border", "Info border"],

  // ── Data viz / charts ─────────────────────────────────────────────────────
  ["chart-1", "Categorical series 1 (primary hue)"],
  ["chart-2", "Categorical series 2"],
  ["chart-3", "Categorical series 3"],
  ["chart-4", "Categorical series 4"],
  ["chart-5", "Categorical series 5"],
  ["chart-6", "Categorical series 6"],
  ["chart-7", "Categorical series 7"],
  ["chart-8", "Categorical series 8"],
  ["chart-gold", "Rank #1 / gold"],
  ["chart-silver", "Rank #2 / silver"],
  ["chart-bronze", "Rank #3 / bronze"],
  ["chart-grid", "Chart gridlines"],
  ["chart-axis", "Chart axis labels/ticks"],
];

/** Just the token names, in order. */
export const TOKEN_NAMES = TOKENS.map(([name]) => name);

/**
 * All themes. Shape:  themes[themeName][mode][token] = "#hex" | "rgba(...)"
 * `mode` is always "light" | "dark".
 *
 * Keep every theme/mode filled in for every token in TOKENS. A small dev-time
 * check in ThemeContext warns if a token is missing.
 */
export const themes = {
  /* ══ DEFAULT — the app's current identity: warm red-brown "#A43B31" ══════ */
  default: {
    light: {
      "primary": "#A43B31",
      "primary-hover": "#8A322A",
      "primary-fg": "#FFFFFF",
      "accent": "#F59E0B",
      "accent-strong": "#B45309",
      "accent-subtle": "#FEF3C7",
      "accent-fg": "#1B1C1C",
      "link": "#2563EB",
      "link-hover": "#1D4ED8",
      "ring": "#F59E0B",
      "disabled": "#E4E2E1",
      "disabled-fg": "#A6A9AE",

      "background": "#FBF9F8",
      "surface": "#FFFFFF",
      "surface-muted": "#F6F3F2",
      "surface-inverse": "#1B1C1C",
      "overlay": "rgba(0,0,0,0.4)",

      "ink": "#1B1C1C",
      "body": "#44474C",
      "muted": "#74777D",
      "inverse": "#FFFFFF",

      "border": "#E4E2E1",
      "border-strong": "#C3C7C8",
      "border-subtle": "#F0EEED",

      "success": "#16A34A",
      "success-fg": "#FFFFFF",
      "success-subtle": "#DCFCE7",
      "success-border": "#86EFAC",

      "error": "#BA1A1A",
      "error-fg": "#FFFFFF",
      "error-subtle": "#FEE2E2",
      "error-border": "#FCA5A5",

      "warning": "#CA8A04",
      "warning-fg": "#1B1C1C",
      "warning-subtle": "#FEF3C7",
      "warning-border": "#FDE68A",

      "info": "#2563EB",
      "info-fg": "#FFFFFF",
      "info-subtle": "#DBEAFE",
      "info-border": "#BFDBFE",

      "chart-1": "#A43B31",
      "chart-2": "#F59E0B",
      "chart-3": "#2563EB",
      "chart-4": "#16A34A",
      "chart-5": "#7C3AED",
      "chart-6": "#0E7490",
      "chart-7": "#BE185D",
      "chart-8": "#B45309",
      "chart-gold": "#D4AF37",
      "chart-silver": "#C0C0C0",
      "chart-bronze": "#CD7F32",
      "chart-grid": "#E4E2E1",
      "chart-axis": "#74777D",
    },
    dark: {
      "primary": "#D46A5E",
      "primary-hover": "#E27B6F",
      "primary-fg": "#2A0C08",
      "accent": "#FBBF24",
      "accent-strong": "#FCD34D",
      "accent-subtle": "#3A2E00",
      "accent-fg": "#1B1C1C",
      "link": "#7CB0FF",
      "link-hover": "#A9CBFF",
      "ring": "#FBBF24",
      "disabled": "#2C3033",
      "disabled-fg": "#6B7075",

      "background": "#141618",
      "surface": "#1E2123",
      "surface-muted": "#282C2E",
      "surface-inverse": "#F6F3F2",
      "overlay": "rgba(0,0,0,0.6)",

      "ink": "#F2F3F4",
      "body": "#C7C9CC",
      "muted": "#9BA0A6",
      "inverse": "#141618",

      "border": "#33383B",
      "border-strong": "#464C50",
      "border-subtle": "#262A2C",

      "success": "#4ADE80",
      "success-fg": "#052B12",
      "success-subtle": "#0E2A17",
      "success-border": "#166534",

      "error": "#FF7A6F",
      "error-fg": "#2A0806",
      "error-subtle": "#3A1512",
      "error-border": "#93000A",

      "warning": "#FBBF24",
      "warning-fg": "#1B1C1C",
      "warning-subtle": "#2E2405",
      "warning-border": "#B7791F",

      "info": "#60A5FA",
      "info-fg": "#06122A",
      "info-subtle": "#10233F",
      "info-border": "#1E40AF",

      "chart-1": "#E06A5E",
      "chart-2": "#FBBF24",
      "chart-3": "#60A5FA",
      "chart-4": "#4ADE80",
      "chart-5": "#A78BFA",
      "chart-6": "#22D3EE",
      "chart-7": "#F472B6",
      "chart-8": "#FCD34D",
      "chart-gold": "#E6C34D",
      "chart-silver": "#D8DADC",
      "chart-bronze": "#D9895A",
      "chart-grid": "#33383B",
      "chart-axis": "#9BA0A6",
    },
  },

  /* ══ BRAND-A — example alternate identity: emerald + indigo ═══════════════ */
  "brand-a": {
    light: {
      "primary": "#047857",
      "primary-hover": "#065F46",
      "primary-fg": "#FFFFFF",
      "accent": "#6366F1",
      "accent-strong": "#4338CA",
      "accent-subtle": "#EEF0FF",
      "accent-fg": "#FFFFFF",
      "link": "#4F46E5",
      "link-hover": "#4338CA",
      "ring": "#6366F1",
      "disabled": "#E4E7E5",
      "disabled-fg": "#9CA3A0",

      "background": "#F7FBF9",
      "surface": "#FFFFFF",
      "surface-muted": "#EEF4F1",
      "surface-inverse": "#0F1E19",
      "overlay": "rgba(6,20,15,0.45)",

      "ink": "#0F1E19",
      "body": "#374b44",
      "muted": "#6B7B75",
      "inverse": "#FFFFFF",

      "border": "#DCE6E1",
      "border-strong": "#BFCFC8",
      "border-subtle": "#ECF2EF",

      "success": "#16A34A",
      "success-fg": "#FFFFFF",
      "success-subtle": "#DCFCE7",
      "success-border": "#86EFAC",

      "error": "#DC2626",
      "error-fg": "#FFFFFF",
      "error-subtle": "#FEE2E2",
      "error-border": "#FCA5A5",

      "warning": "#D97706",
      "warning-fg": "#1B1C1C",
      "warning-subtle": "#FEF3C7",
      "warning-border": "#FDE68A",

      "info": "#0EA5E9",
      "info-fg": "#FFFFFF",
      "info-subtle": "#E0F2FE",
      "info-border": "#BAE6FD",

      "chart-1": "#047857",
      "chart-2": "#6366F1",
      "chart-3": "#0EA5E9",
      "chart-4": "#F59E0B",
      "chart-5": "#EC4899",
      "chart-6": "#14B8A6",
      "chart-7": "#8B5CF6",
      "chart-8": "#65A30D",
      "chart-gold": "#D4AF37",
      "chart-silver": "#C0C0C0",
      "chart-bronze": "#CD7F32",
      "chart-grid": "#DCE6E1",
      "chart-axis": "#6B7B75",
    },
    dark: {
      "primary": "#34D399",
      "primary-hover": "#6EE7B7",
      "primary-fg": "#04231A",
      "accent": "#A5B4FC",
      "accent-strong": "#C7D2FE",
      "accent-subtle": "#1E1B4B",
      "accent-fg": "#0B1020",
      "link": "#A5B4FC",
      "link-hover": "#C7D2FE",
      "ring": "#A5B4FC",
      "disabled": "#2A302E",
      "disabled-fg": "#6B736F",

      "background": "#0E1613",
      "surface": "#16211D",
      "surface-muted": "#1F2C27",
      "surface-inverse": "#EEF4F1",
      "overlay": "rgba(0,0,0,0.6)",

      "ink": "#ECF4F0",
      "body": "#BFCFC8",
      "muted": "#8A9A93",
      "inverse": "#0E1613",

      "border": "#2C3B35",
      "border-strong": "#3E4F48",
      "border-subtle": "#212E29",

      "success": "#4ADE80",
      "success-fg": "#052B12",
      "success-subtle": "#0E2A17",
      "success-border": "#166534",

      "error": "#FF7A6F",
      "error-fg": "#2A0806",
      "error-subtle": "#3A1512",
      "error-border": "#93000A",

      "warning": "#FBBF24",
      "warning-fg": "#1B1C1C",
      "warning-subtle": "#2E2405",
      "warning-border": "#B7791F",

      "info": "#38BDF8",
      "info-fg": "#04202E",
      "info-subtle": "#0C2A3A",
      "info-border": "#0369A1",

      "chart-1": "#34D399",
      "chart-2": "#A5B4FC",
      "chart-3": "#38BDF8",
      "chart-4": "#FBBF24",
      "chart-5": "#F472B6",
      "chart-6": "#2DD4BF",
      "chart-7": "#C4B5FD",
      "chart-8": "#A3E635",
      "chart-gold": "#E6C34D",
      "chart-silver": "#D8DADC",
      "chart-bronze": "#D9895A",
      "chart-grid": "#2C3B35",
      "chart-axis": "#8A9A93",
    },
  },

  /* ══ BRAND-B — example alternate identity: indigo + pink ══════════════════ */
  "brand-b": {
    light: {
      "primary": "#4F46E5",
      "primary-hover": "#4338CA",
      "primary-fg": "#FFFFFF",
      "accent": "#EC4899",
      "accent-strong": "#BE185D",
      "accent-subtle": "#FCE7F3",
      "accent-fg": "#FFFFFF",
      "link": "#4F46E5",
      "link-hover": "#4338CA",
      "ring": "#6366F1",
      "disabled": "#E5E5EA",
      "disabled-fg": "#9CA0AB",

      "background": "#FAFAFF",
      "surface": "#FFFFFF",
      "surface-muted": "#F1F1FB",
      "surface-inverse": "#171633",
      "overlay": "rgba(15,15,40,0.45)",

      "ink": "#171633",
      "body": "#3F3F5A",
      "muted": "#6E6E86",
      "inverse": "#FFFFFF",

      "border": "#E4E3F1",
      "border-strong": "#C9C7E0",
      "border-subtle": "#EFEEF8",

      "success": "#16A34A",
      "success-fg": "#FFFFFF",
      "success-subtle": "#DCFCE7",
      "success-border": "#86EFAC",

      "error": "#E11D48",
      "error-fg": "#FFFFFF",
      "error-subtle": "#FFE4E6",
      "error-border": "#FDA4AF",

      "warning": "#D97706",
      "warning-fg": "#1B1C1C",
      "warning-subtle": "#FEF3C7",
      "warning-border": "#FDE68A",

      "info": "#2563EB",
      "info-fg": "#FFFFFF",
      "info-subtle": "#DBEAFE",
      "info-border": "#BFDBFE",

      "chart-1": "#4F46E5",
      "chart-2": "#EC4899",
      "chart-3": "#0EA5E9",
      "chart-4": "#10B981",
      "chart-5": "#F59E0B",
      "chart-6": "#8B5CF6",
      "chart-7": "#F43F5E",
      "chart-8": "#14B8A6",
      "chart-gold": "#D4AF37",
      "chart-silver": "#C0C0C0",
      "chart-bronze": "#CD7F32",
      "chart-grid": "#E4E3F1",
      "chart-axis": "#6E6E86",
    },
    dark: {
      "primary": "#818CF8",
      "primary-hover": "#A5B4FC",
      "primary-fg": "#0B1020",
      "accent": "#F472B6",
      "accent-strong": "#F9A8D4",
      "accent-subtle": "#3B1029",
      "accent-fg": "#2A0817",
      "link": "#A5B4FC",
      "link-hover": "#C7D2FE",
      "ring": "#818CF8",
      "disabled": "#2B2B39",
      "disabled-fg": "#6B6B80",

      "background": "#0E0E1A",
      "surface": "#181827",
      "surface-muted": "#212132",
      "surface-inverse": "#F1F1FB",
      "overlay": "rgba(0,0,0,0.6)",

      "ink": "#EEEEF6",
      "body": "#C4C4D6",
      "muted": "#9292A8",
      "inverse": "#0E0E1A",

      "border": "#2C2C3E",
      "border-strong": "#3E3E54",
      "border-subtle": "#22222F",

      "success": "#4ADE80",
      "success-fg": "#052B12",
      "success-subtle": "#0E2A17",
      "success-border": "#166534",

      "error": "#FB7185",
      "error-fg": "#2A0810",
      "error-subtle": "#3A1220",
      "error-border": "#9F1239",

      "warning": "#FBBF24",
      "warning-fg": "#1B1C1C",
      "warning-subtle": "#2E2405",
      "warning-border": "#B7791F",

      "info": "#60A5FA",
      "info-fg": "#06122A",
      "info-subtle": "#10233F",
      "info-border": "#1E40AF",

      "chart-1": "#818CF8",
      "chart-2": "#F472B6",
      "chart-3": "#38BDF8",
      "chart-4": "#34D399",
      "chart-5": "#FBBF24",
      "chart-6": "#A78BFA",
      "chart-7": "#FB7185",
      "chart-8": "#2DD4BF",
      "chart-gold": "#E6C34D",
      "chart-silver": "#D8DADC",
      "chart-bronze": "#D9895A",
      "chart-grid": "#2C2C3E",
      "chart-axis": "#9292A8",
    },
  },
};

/** Themes exposed to the UI switcher (label + value). Add new themes here. */
export const THEME_LIST = [
  { value: "default", label: "Default" },
  { value: "brand-a", label: "Brand A" },
  { value: "brand-b", label: "Brand B" },
];

export const MODE_LIST = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
];

export const DEFAULT_THEME = "default";
export const DEFAULT_MODE = "light"; // used only when system preference is unavailable

export const THEME_NAMES = Object.keys(themes);