// Input routing for a real-whiteboard feel:
//  - the board never zooms: no pinch, no ctrl/cmd-wheel, no keyboard zoom, no fit shortcuts
//  - one finger pans at the fixed scale; a quick finger tap opens the project under it
//  - pens (pointerType "pen", e.g. a Samsung S Pen in Chrome) go straight to Excalidraw and draw
//  - while a pen is down, all touch input is ignored (palm rejection, as far as the browser reports
//    palms as touch pointers; real palm handling depends on the device and browser)
// Mouse input on desktop is passed through unchanged.

export function installInputRouting(root, { getApi, getZoom, onTap }) {
  const isCanvas = (t) => t instanceof HTMLCanvasElement;
  const touches = new Map(); // pointerId -> {x, y, t, startX, startY}
  const pens = new Set(); // pointerIds of pens currently down
  let pan = null; // {id, lastX, lastY}

  const swallow = (e) => { e.stopPropagation(); if (e.cancelable) e.preventDefault(); };

  function onPointerDown(e) {
    if (!isCanvas(e.target)) return;
    if (e.pointerType === "pen") { pens.add(e.pointerId); touches.clear(); pan = null; return; } // let Excalidraw draw
    if (e.pointerType !== "touch") return; // mouse: unchanged
    swallow(e);
    if (pens.size) return; // palm while writing
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, t: Date.now(), startX: e.clientX, startY: e.clientY });
    try { e.target.setPointerCapture(e.pointerId); } catch {}
    pan = touches.size === 1 ? { id: e.pointerId, lastX: e.clientX, lastY: e.clientY } : null; // 2+ fingers: no pinch-zoom, no pan
  }
  function onPointerMove(e) {
    if (e.pointerType !== "touch" || !touches.has(e.pointerId)) return;
    swallow(e);
    if (pens.size || !pan || pan.id !== e.pointerId) return;
    const api = getApi();
    if (!api) return;
    const z = getZoom(), st = api.getAppState();
    api.updateScene({ appState: { scrollX: st.scrollX + (e.clientX - pan.lastX) / z, scrollY: st.scrollY + (e.clientY - pan.lastY) / z } });
    pan.lastX = e.clientX; pan.lastY = e.clientY;
  }
  function onPointerUp(e) {
    if (e.pointerType !== "touch" || !touches.has(e.pointerId)) return;
    swallow(e);
    const s = touches.get(e.pointerId);
    touches.delete(e.pointerId);
    if (pan?.id === e.pointerId) pan = null;
    const tap = e.type === "pointerup" && !pens.size && touches.size === 0 && Math.hypot(e.clientX - s.startX, e.clientY - s.startY) < 10 && Date.now() - s.t < 450;
    if (tap) onTap(e.clientX, e.clientY);
  }
  // Excalidraw also listens to raw touch and Safari gesture events (pinch zoom): block them on the canvas.
  const blockTouch = (e) => { if (isCanvas(e.target)) swallow(e); };
  const blockWheelZoom = (e) => { if (e.ctrlKey || e.metaKey) swallow(e); }; // plain wheel/trackpad scroll still pans
  const blockKeyZoom = (e) => {
    const k = e.key;
    if (((e.ctrlKey || e.metaKey) && ["=", "+", "-", "_", "0"].includes(k)) || (e.shiftKey && ["!", "@", "1", "2"].includes(k) && !/INPUT|TEXTAREA/.test(document.activeElement?.tagName || "") && !document.activeElement?.isContentEditable)) swallow(e);
  };

  // Pen lifts can land anywhere (or be dispatched on window by the loupe), so track them globally.
  const penUp = (e) => { if (e.pointerType === "pen") pens.delete(e.pointerId); };
  const penDownAnywhere = (e) => { if (e.pointerType === "pen" && isCanvas(e.target)) pens.add(e.pointerId); };
  window.addEventListener("pointerup", penUp, true);
  window.addEventListener("pointercancel", penUp, true);
  window.addEventListener("pointerdown", penDownAnywhere, true);
  const opts = { capture: true, passive: false };
  root.addEventListener("pointerdown", onPointerDown, opts);
  root.addEventListener("pointermove", onPointerMove, opts);
  root.addEventListener("pointerup", onPointerUp, opts);
  root.addEventListener("pointercancel", onPointerUp, opts);
  for (const t of ["touchstart", "touchmove", "touchend", "gesturestart", "gesturechange", "gestureend"]) root.addEventListener(t, blockTouch, opts);
  root.addEventListener("wheel", blockWheelZoom, opts);
  window.addEventListener("keydown", blockKeyZoom, true);
  return () => {
    root.removeEventListener("pointerdown", onPointerDown, opts);
    root.removeEventListener("pointermove", onPointerMove, opts);
    root.removeEventListener("pointerup", onPointerUp, opts);
    root.removeEventListener("pointercancel", onPointerUp, opts);
    for (const t of ["touchstart", "touchmove", "touchend", "gesturestart", "gesturechange", "gestureend"]) root.removeEventListener(t, blockTouch, opts);
    root.removeEventListener("wheel", blockWheelZoom, opts);
    window.removeEventListener("keydown", blockKeyZoom, true);
    window.removeEventListener("pointerup", penUp, true);
    window.removeEventListener("pointercancel", penUp, true);
    window.removeEventListener("pointerdown", penDownAnywhere, true);
  };
}
