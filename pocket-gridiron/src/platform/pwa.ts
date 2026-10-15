/**
 * Registers the service worker (production builds only) so the game installs to the home screen
 * and works offline after the first visit. Failures are harmless: the game runs without it.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const register = () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {
      /* sandboxed or unsupported context */
    });
  };
  // Startup is async, so the load event may already have fired.
  if (document.readyState === "complete") register();
  else window.addEventListener("load", register, { once: true });
}

/** True when launched from the home screen (iOS standalone or display-mode fullscreen/standalone). */
export function isInstalled(): boolean {
  try {
    const nav = navigator as Navigator & { standalone?: boolean };
    return !!nav.standalone || matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: fullscreen)").matches;
  } catch {
    return false;
  }
}
