/**
 * ThemeProvider / useTheme — runtime theme + light/dark switching.
 *
 * Responsibilities
 * ----------------
 *  • Generates one `:root[data-theme=..][data-mode=..] { --color-*: … }` CSS
 *    block per theme/mode from ./themes.js and injects it once into <head>.
 *    (This is exactly the CSS-variable structure described in the spec, but
 *     generated from the single source of truth so the two can never drift.)
 *  • Sets `data-theme` and `data-mode` on <html>, so the correct block wins
 *    via the CSS cascade. Switching themes = changing two attributes; no
 *    per-property JS thrash, and it works for CSS-only consumers too.
 *  • Persists the user's choice to localStorage.
 *  • Defaults `mode` to the OS preference (prefers-color-scheme) and `theme`
 *    to DEFAULT_THEME, and live-follows the OS until the user picks a mode.
 *
 * Consuming colors
 * ----------------
 *  • In JSX: just use semantic Tailwind classes — `bg-primary`, `text-error`…
 *  • In JS/GSAP/canvas: call `readCssColor('primary')` (reads the live CSS
 *    variable, so it always matches the active theme/mode), or use the
 *    `useThemeColor()` / `useThemeColors()` hooks which re-read on change.
 */
import {
    createContext,
    useContext,
    useEffect,
    useMemo,
    useState,
    useCallback,
} from "react";
import {
    themes,
    TOKEN_NAMES,
    THEME_NAMES,
    DEFAULT_THEME,
    DEFAULT_MODE,
} from "./themes.js";

const STORAGE_KEY = "app-theme";
const STYLE_EL_ID = "app-theme-vars";

/* ── CSS generation ─────────────────────────────────────────────────────── */

/** Build the full stylesheet: one selector block per theme + mode. */
function buildThemeCss() {
    let css = "";
    for (const themeName of THEME_NAMES) {
        for (const mode of ["light", "dark"]) {
            const values = themes[themeName]?.[mode];
            if (!values) continue;
            const decls = TOKEN_NAMES.map(
                (token) => `  --color-${token}: ${values[token] ?? "initial"};`
            ).join("\n");
            css += `:root[data-theme="${themeName}"][data-mode="${mode}"] {\n${decls}\n}\n`;
        }
    }
    return css;
}

/** Dev-only: warn if any theme/mode is missing a token defined in TOKENS. */
function validateThemes() {
    if (typeof import.meta !== "undefined" && import.meta.env?.PROD) return;
    for (const themeName of THEME_NAMES) {
        for (const mode of ["light", "dark"]) {
            const values = themes[themeName]?.[mode];
            if (!values) {
                console.warn(`[theme] "${themeName}" is missing the "${mode}" mode.`);
                continue;
            }
            const missing = TOKEN_NAMES.filter((t) => values[t] == null);
            if (missing.length) {
                console.warn(
                    `[theme] "${themeName}.${mode}" is missing tokens: ${missing.join(", ")}`
                );
            }
        }
    }
}

/** Inject (once) the generated theme stylesheet into <head>. */
function ensureThemeStyleInjected() {
    if (typeof document === "undefined") return;
    let el = document.getElementById(STYLE_EL_ID);
    if (!el) {
        el = document.createElement("style");
        el.id = STYLE_EL_ID;
        document.head.appendChild(el);
    }
    if (!el.dataset.built) {
        validateThemes();
        el.textContent = buildThemeCss();
        el.dataset.built = "1";
    }
}

/* ── Persistence / defaults ─────────────────────────────────────────────── */

function getSystemMode() {
    if (typeof window === "undefined" || !window.matchMedia) return DEFAULT_MODE;
    return window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
}

function readStored() {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return typeof parsed === "object" && parsed ? parsed : {};
    } catch {
        return {};
    }
}

/* ── Live color reading (for GSAP / canvas / non-CSS consumers) ──────────── */

/**
 * Read a resolved theme color from the live CSS variables.
 * Always reflects the currently-active theme + mode.
 * @param {string} token  e.g. "primary", "text-muted", "chart-1"
 * @param {string} [fallback]
 * @returns {string} e.g. "#A43B31"
 */
export function readCssColor(token, fallback = "") {
    if (typeof window === "undefined") return fallback;
    const v = getComputedStyle(document.documentElement)
        .getPropertyValue(`--color-${token}`)
        .trim();
    return v || fallback;
}

/* ── Context ─────────────────────────────────────────────────────────────── */

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
    // Inject the generated CSS synchronously on first render so there is no FOUC.
    if (typeof document !== "undefined") ensureThemeStyleInjected();

    const stored = readStored();

    const [theme, setThemeState] = useState(() =>
        THEME_NAMES.includes(stored.theme) ? stored.theme : DEFAULT_THEME
    );
    // `mode` may be null → meaning "follow the system".
    const [mode, setModeState] = useState(() =>
        stored.mode === "light" || stored.mode === "dark"
            ? stored.mode
            : getSystemMode()
    );
    // Whether the user has explicitly chosen a mode (stops OS auto-following).
    const [modePinned, setModePinned] = useState(
        () => stored.mode === "light" || stored.mode === "dark"
    );

    // Apply attributes to <html> whenever theme/mode change.
    useEffect(() => {
        const root = document.documentElement;
        root.setAttribute("data-theme", theme);
        root.setAttribute("data-mode", mode);
        root.style.colorScheme = mode; // native form controls / scrollbars
    }, [theme, mode]);

    // Persist selection.
    useEffect(() => {
        try {
            localStorage.setItem(
                STORAGE_KEY,
                JSON.stringify({ theme, mode: modePinned ? mode : null })
            );
        } catch {
            /* ignore quota / privacy-mode errors */
        }
    }, [theme, mode, modePinned]);

    // Follow OS mode until the user pins one.
    useEffect(() => {
        if (modePinned || typeof window === "undefined" || !window.matchMedia)
            return;
        const mq = window.matchMedia("(prefers-color-scheme: dark)");
        const onChange = (e) => setModeState(e.matches ? "dark" : "light");
        mq.addEventListener?.("change", onChange);
        return () => mq.removeEventListener?.("change", onChange);
    }, [modePinned]);

    const setTheme = useCallback((next) => {
        if (THEME_NAMES.includes(next)) setThemeState(next);
    }, []);

    const setMode = useCallback((next) => {
        if (next === "light" || next === "dark") {
            setModePinned(true);
            setModeState(next);
        }
    }, []);

    const toggleMode = useCallback(() => {
        setModePinned(true);
        setModeState((m) => (m === "dark" ? "light" : "dark"));
    }, []);

    /** Revert to following the OS preference. */
    const useSystemMode = useCallback(() => {
        setModePinned(false);
        setModeState(getSystemMode());
    }, []);

    const value = useMemo(
        () => ({
            theme,
            mode,
            modePinned,
            setTheme,
            setMode,
            toggleMode,
            useSystemMode,
            readColor: readCssColor,
        }),
        [theme, mode, modePinned, setTheme, setMode, toggleMode, useSystemMode]
    );

    return (
        <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
    );
}

/** Access + control the current theme/mode. */
export function useTheme() {
    const ctx = useContext(ThemeContext);
    if (!ctx) throw new Error("useTheme must be used within a <ThemeProvider>");
    return ctx;
}

/**
 * Resolve a single theme color, re-reading whenever the theme/mode changes.
 * Handy inside GSAP effects: `const brand = useThemeColor('primary')`.
 */
export function useThemeColor(token, fallback = "") {
    const { theme, mode } = useTheme();
    return useMemo(
        () => readCssColor(token, fallback),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [token, fallback, theme, mode]
    );
}

/**
 * Resolve many theme colors at once.
 * `const c = useThemeColors(['primary','accent']); c.primary`
 */
export function useThemeColors(tokens) {
    const { theme, mode } = useTheme();
    return useMemo(
        () => {
            const out = {};
            for (const t of tokens) out[t] = readCssColor(t);
            return out;
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [tokens.join(","), theme, mode]
    );
}