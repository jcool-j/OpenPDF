export type PointerMode = "select" | "hand";
const KEY = "openpdf.pointerMode";
export function initialPointerMode(): PointerMode {
  try { return localStorage.getItem(KEY) === "hand" ? "hand" : "select"; }
  catch { return "select"; }
}
export function storePointerMode(mode: PointerMode) {
  try { localStorage.setItem(KEY, mode); } catch { /* Storage is optional. */ }
}

/** Drag scrolling without stealing links, form controls, or annotation handles. */
export function installHandPan(container: HTMLElement): () => void {
  let drag: { id: number; x: number; y: number; left: number; top: number } | null = null;
  let moved = false;
  const down = (event: PointerEvent) => {
    if (event.button !== 0 || event.pointerType === "touch" ||
        !container.classList.contains("hand-mode") ||
        (event.target as HTMLElement).closest("a,button,input,textarea,select,[contenteditable=true],.openpdf-note")) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, left: container.scrollLeft, top: container.scrollTop };
    moved = false;
    container.setPointerCapture(event.pointerId);
    container.classList.add("is-panning");
    event.preventDefault();
  };
  const move = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    moved ||= Math.abs(dx) + Math.abs(dy) > 4;
    container.scrollLeft = drag.left - dx;
    container.scrollTop = drag.top - dy;
    event.preventDefault();
  };
  const up = (event: PointerEvent) => {
    if (!drag || drag.id !== event.pointerId) return;
    drag = null;
    container.classList.remove("is-panning");
    if (container.hasPointerCapture(event.pointerId)) container.releasePointerCapture(event.pointerId);
  };
  const click = (event: MouseEvent) => {
    if (moved) { event.preventDefault(); event.stopPropagation(); moved = false; }
  };
  container.addEventListener("pointerdown", down);
  container.addEventListener("pointermove", move);
  container.addEventListener("pointerup", up);
  container.addEventListener("pointercancel", up);
  container.addEventListener("lostpointercapture", up);
  container.addEventListener("click", click, true);
  return () => {
    container.removeEventListener("pointerdown", down);
    container.removeEventListener("pointermove", move);
    container.removeEventListener("pointerup", up);
    container.removeEventListener("pointercancel", up);
    container.removeEventListener("lostpointercapture", up);
    container.removeEventListener("click", click, true);
    container.classList.remove("is-panning");
  };
}
