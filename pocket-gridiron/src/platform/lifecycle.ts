/**
 * App lifecycle: tells the game when Safari is backgrounded, the phone locks, or the page is
 * hidden, so play pauses and audio suspends. Fires `onResume` when visible again.
 */
export function watchLifecycle(onHide: () => void, onResume: () => void): void {
  let hidden = false;
  const hide = () => {
    if (hidden) return;
    hidden = true;
    onHide();
  };
  const show = () => {
    if (!hidden) return;
    hidden = false;
    onResume();
  };
  document.addEventListener("visibilitychange", () => (document.hidden ? hide() : show()));
  window.addEventListener("pagehide", hide);
  window.addEventListener("pageshow", () => !document.hidden && show());
  window.addEventListener("blur", () => document.hidden && hide());
}
