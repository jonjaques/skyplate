/**
 * Theme preference (system / light / dark) and the surface it resolves to.
 *
 * index.html resolves the theme into data-theme on <html> before first paint, reading the same
 * "starchart-theme" key written here, so a reload never flashes the wrong ground. This module
 * keeps that attribute in step with the store afterwards and, under "system", with the OS.
 * Components that pick a swatch step (light trays vs dark trays) read the attribute itself,
 * because it is the one value every surface actually renders with.
 */

import { useEffect, useSyncExternalStore } from "react";
import type { Surface } from "../lib/colors";
import { useViewer, type ThemePref } from "../state/store";

const KEY = "starchart-theme";
const DARK_QUERY = "(prefers-color-scheme: dark)";

export function readThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    // Storage can be blocked (file:// in some browsers, private modes); the OS setting stands.
    return "system";
  }
}

function apply(pref: ThemePref): void {
  const dark = pref === "system" ? matchMedia(DARK_QUERY).matches : pref === "dark";
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
}

/**
 * Seed the store with the saved preference before the first render. Doing this in a mount
 * effect instead races the persistence effect below: under StrictMode the effects run twice,
 * and the second read happens after the first pass's "system" default removed the key.
 */
export function initTheme(): void {
  useViewer.getState().setTheme(readThemePref());
}

/** Mount once: keeps data-theme and storage in step with the store's preference. */
export function useThemeSync(): void {
  const theme = useViewer((s) => s.theme);

  useEffect(() => {
    apply(theme);
    try {
      if (theme === "system") localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, theme);
    } catch {
      // See readThemePref: the choice still applies for this visit.
    }
    if (theme !== "system") return;
    const media = matchMedia(DARK_QUERY);
    const onChange = () => apply("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);
}

function readSurface(): Surface {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

// One observer for every subscriber. The trays, the record and the Charts tab each subscribe,
// and a whole Charts tab is dozens of components; one MutationObserver apiece did the same
// work dozens of times on every theme flip.
const surfaceListeners = new Set<() => void>();
let surfaceObserver: MutationObserver | null = null;

function subscribeSurface(onChange: () => void): () => void {
  surfaceListeners.add(onChange);
  if (!surfaceObserver) {
    surfaceObserver = new MutationObserver(() => {
      for (const l of surfaceListeners) l();
    });
    surfaceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  }
  return () => {
    surfaceListeners.delete(onChange);
    if (surfaceListeners.size === 0) {
      surfaceObserver?.disconnect();
      surfaceObserver = null;
    }
  };
}

/**
 * The surface the trays render on right now, for choosing light or dark swatch steps. This is
 * the viewer's only reader of the resolved theme; the charts kit re-exports it.
 */
export function useSurface(): Surface {
  return useSyncExternalStore(subscribeSurface, readSurface, () => "light");
}
