import { createSignal } from "solid-js";

/**
 * Which theme the app is showing, and how a person changes it.
 *
 * Three states, not two. "system" is the default and stores nothing, so the stylesheet's
 * `prefers-color-scheme` query answers; choosing light or dark stamps `data-mode` on the root and
 * remembers it. `public/theme.js` applies the stored one before the first paint.
 */
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

const KEY = "testate-theme";

function stored(): Theme {
  try {
    const found = localStorage.getItem(KEY);
    return found === "light" || found === "dark" ? found : "system";
  } catch {
    // A browser with storage blocked follows the system preference and forgets between visits.
    return "system";
  }
}

const [theme, setThemeSignal] = createSignal<Theme>(stored());

export { theme };

/** The label for the theme a click would move to, so the control can say what it does. */
export function nextTheme(current: Theme): Theme {
  return THEMES[(THEMES.indexOf(current) + 1) % THEMES.length] ?? "system";
}

export function setTheme(next: Theme): void {
  setThemeSignal(next);
  const root = document.documentElement;
  if (next === "system") delete root.dataset["mode"];
  else root.dataset["mode"] = next;
  try {
    if (next === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    // The choice still applies to this page; it just will not survive a reload.
  }
}
