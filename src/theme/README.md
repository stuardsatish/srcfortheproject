# Theme system

Centralized, semantic color theming for the storefront + admin app. Change the
whole app's colors from **one file**, switch themes/modes at runtime, and get
light + dark for every theme.

> Scope: the storefront + admin UI. The bespoke marketing/landing pages
> (`LandingPage/*`, `MeltHeader/Footer`, `ScrollSequence`, `Demo/*`,
> `Optimization`, `TestingPage`) keep their own hand-tuned aesthetic and are
> intentionally **not** driven by these tokens.

## How it works

```
src/theme/themes.js        ← single source of truth: every token value,
                             per theme, per light/dark mode
src/theme/ThemeContext.jsx ← <ThemeProvider>, useTheme(), useThemeColor(),
                             readCssColor()  (+ generates & injects the CSS)
src/theme/ThemeSwitcher.jsx← optional drop-in UI control
src/index.css  @theme      ← declares --color-* tokens so Tailwind emits the
                             bg-/text-/border-/ring-/from-… utilities
index.html <script>        ← sets data-theme/data-mode before paint (no flash)
```

Flow: components use **semantic Tailwind classes** (`bg-primary`,
`text-error`, `border-border`). Those resolve to `var(--color-*)`. The
`ThemeProvider` generates one CSS block per theme+mode from `themes.js`:

```css
:root[data-theme="default"][data-mode="light"] { --color-primary: #A43B31; … }
:root[data-theme="default"][data-mode="dark"]  { --color-primary: #D46A5E; … }
```

and flips `data-theme` / `data-mode` on `<html>`. The cascade does the rest —
no rebuild, no per-property JS.

## Using colors

**In JSX** — just use the semantic class:

```jsx
<button className="bg-primary text-primary-fg hover:bg-primary-hover">Buy</button>
<h2 className="text-ink">Heading</h2>          {/* strongest text */}
<p className="text-body">body copy</p>
<span className="text-muted">caption</span>
<span className="text-primary">₹499</span>         {/* brand-colored text */}
<div className="bg-surface border border-border" />
<span className="text-error">Out of stock</span>
```

> Foreground/text tokens are **prefix-free** (`ink`, `body`, `muted`,
> `inverse`) so the class reads `text-ink`, not `text-text-primary`. This also
> leaves `text-primary` free to mean *brand-colored text* (from `--color-primary`).

**In JS / GSAP / canvas** — read the live variable so animations respect the
active theme:

```js
import { readCssColor } from "@/theme/ThemeContext";
gsap.to(el, { backgroundColor: readCssColor("primary") });

// or, reactive to theme changes, inside a component/effect:
const brand = useThemeColor("primary");
```

**Switching at runtime:**

```jsx
const { theme, mode, setTheme, setMode, toggleMode, useSystemMode } = useTheme();
setTheme("brand-a");   // change theme
toggleMode();          // light ⇄ dark  (pins the choice)
useSystemMode();       // go back to following the OS preference
```

Selection persists to `localStorage` (`app-theme`). Mode defaults to the OS
`prefers-color-scheme` until the user explicitly picks one.

## Recipes

### a) Change an existing theme's colors

Edit the hex values in `src/theme/themes.js` under the theme + mode you want.
That's it — save and the app updates.

### b) Add a new theme

1. In `themes.js`, copy a whole theme block (e.g. `"brand-a"`), rename the key
   (e.g. `"summer"`), and adjust the hexes for both `light` and `dark`.
2. Add it to `THEME_LIST` so it appears in the switcher:
   ```js
   export const THEME_LIST = [
     { value: "default", label: "Default" },
     { value: "summer",  label: "Summer"  },
   ];
   ```
   It's usable immediately via `setTheme("summer")`.

### c) Add a new semantic token

1. Add `["my-token", "what it's for"]` to `TOKENS` in `themes.js`.
2. Add a value for it in **every** theme/mode block in `themes.js`.
3. Declare it in the `@theme` block of `src/index.css` so Tailwind generates
   the utilities:
   ```css
   --color-my-token: #<default-light-value>;
   ```
4. Use `bg-my-token` / `text-my-token` / etc. in components.

A dev-time check in `ThemeContext.jsx` will warn if a token is missing from a
theme/mode.

## Token reference

| Group | Tokens |
|---|---|
| Interactive | `primary` `primary-hover` `primary-fg` · `accent` `accent-strong` `accent-subtle` `accent-fg` · `link` `link-hover` · `ring` · `disabled` `disabled-fg` |
| Surfaces | `background` `surface` `surface-muted` `surface-inverse` `overlay` |
| Text / foreground | `ink` `body` `muted` `inverse` (disabled text → `disabled-fg`) |
| Borders | `border` `border-strong` `border-subtle` |
| Status | `success` `error` `warning` `info` — each also `-fg` `-subtle` `-border` |
| Charts | `chart-1…8` `chart-gold` `chart-silver` `chart-bronze` `chart-grid` `chart-axis` |

> `white`, `black`, `transparent`, `current` are Tailwind built-ins and are
> intentionally **not** themed. For anything that must flip between light and
> dark, use `surface` / `inverse` / `background` instead of `white`/`black`.

## Live example: the navbar's sun/moon toggle

`src/components/Layout/Navbar.jsx` wires `useTheme()` directly to the
`FaSun`/`FaMoon` icons (desktop bar + mobile drawer):

```jsx
const { mode, setMode } = useTheme();
const darkMode = mode === "dark";
...
<button onClick={() => setMode(darkMode ? "light" : "dark")}>
  {darkMode ? <FaSun /> : <FaMoon />}
</button>
```

The icon shown is the mode you'll switch **to**: in dark mode you see the Sun
(click → light), in light mode you see the Moon (click → dark). This replaced
a previous Redux `ThemeSlice` toggle that only flipped an unused `darkMode`
flag and never touched the actual page colors.