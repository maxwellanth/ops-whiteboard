import { useEffect, useRef } from "react";

// A movable magnifying glass over the board. The board itself never zooms; the loupe shows a
// magnified live copy of the area under it, so layout and surroundings stay where they are.
//  - drag it with a finger or mouse (anywhere on the lens)
//  - write in it with a pen: each pen point is mapped from lens coordinates back to the real board
//    position under the lens centre and handed to Excalidraw as if the pen touched there, so the
//    stroke is saved at the SAME board coordinates as a stroke made directly on the board.
export const LOUPE_MAG = 2.5;

export default function Loupe({ pos, setPos, onClose, size = 220 }) {
  const ref = useRef(null);
  const cv = useRef(null);
  const drag = useRef(null);
  const pen = useRef(null);
  const posRef = useRef(pos);
  posRef.current = pos;

  // Live copy of the board's canvases (static scene + strokes in progress), magnified.
  useEffect(() => {
    let raf;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const host = ref.current?.parentElement;
      const out = cv.current;
      if (!host || !out) return;
      const srcs = [...host.querySelectorAll(".excalidraw canvas")].filter((c) => !c.classList.contains("interactive") && c.width > 0);
      const dpr = window.devicePixelRatio || 1;
      if (out.width !== size * dpr) { out.width = size * dpr; out.height = size * dpr; }
      const ctx = out.getContext("2d");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, out.width, out.height);
      const hostBox = host.getBoundingClientRect();
      const half = size / 2 / LOUPE_MAG;
      for (const c of srcs) {
        const b = c.getBoundingClientRect();
        if (!b.width) continue;
        const sx = (c.width / b.width), sy = (c.height / b.height);
        const cx = hostBox.left + posRef.current.x - b.left, cy = hostBox.top + posRef.current.y - b.top;
        ctx.drawImage(c, (cx - half) * sx, (cy - half) * sy, half * 2 * sx, half * 2 * sy, 0, 0, out.width, out.height);
      }
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [size]);

  // Lens point -> the real board viewport point under it
  const toBoard = (e) => {
    const box = ref.current.getBoundingClientRect();
    const lx = e.clientX - (box.left + box.width / 2), ly = e.clientY - (box.top + box.height / 2);
    const host = ref.current.parentElement.getBoundingClientRect();
    return { clientX: host.left + posRef.current.x + lx / LOUPE_MAG, clientY: host.top + posRef.current.y + ly / LOUPE_MAG };
  };
  const target = () => ref.current?.parentElement.querySelector(".excalidraw canvas.interactive");
  // Forwarded strokes use their own pointer id, so the real pen pointer stays captured by the lens and its raw
  // (unmapped) positions never reach the board. Excalidraw tries to capture the forwarded id, which is not a live
  // browser pointer, so capture calls are made harmless for the duration of the dispatch.
  const forward = (type, e, dest) => {
    const p = toBoard(e);
    const cv = target();
    const saved = cv && [cv.setPointerCapture, cv.releasePointerCapture];
    if (cv) { cv.setPointerCapture = () => {}; cv.releasePointerCapture = () => {}; }
    const ev = new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 9000 + e.pointerId, pointerType: "pen", isPrimary: true,
      clientX: p.clientX, clientY: p.clientY, pressure: e.pressure || 0.5, tiltX: e.tiltX, tiltY: e.tiltY, button: type === "pointermove" ? -1 : 0, buttons: type === "pointerup" ? 0 : 1 });
    try { dest.dispatchEvent(ev); } finally { if (cv) [cv.setPointerCapture, cv.releasePointerCapture] = saved; }
  };

  const down = (e) => {
    e.stopPropagation(); e.preventDefault();
    try { ref.current.setPointerCapture(e.pointerId); } catch {}
    if (e.pointerType === "pen") { const t = target(); if (t) { pen.current = e.pointerId; forward("pointerdown", e, t); } return; }
    if (pen.current != null) return; // ignore palm while the pen writes in the lens
    drag.current = { id: e.pointerId, dx: e.clientX - posRef.current.x, dy: e.clientY - posRef.current.y };
  };
  const move = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (pen.current === e.pointerId) { const t = target(); return t && forward("pointermove", e, t); }
    if (drag.current?.id === e.pointerId) setPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy });
  };
  const up = (e) => {
    e.stopPropagation(); e.preventDefault();
    if (pen.current === e.pointerId) { const t = target(); if (t) forward("pointerup", e, t); pen.current = null; return; }
    if (drag.current?.id === e.pointerId) drag.current = null;
  };

  return (
    <div ref={ref} className="loupe" style={{ left: pos.x - size / 2, top: pos.y - size / 2, width: size, height: size }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} role="region" aria-label={`Magnifier, ${LOUPE_MAG}×. Drag to move; write in it with a pen.`}>
      <canvas ref={cv} style={{ width: size, height: size }} />
      <span className="loupe-cross" aria-hidden="true" />
      <button className="loupe-x" onPointerDown={(e) => { e.stopPropagation(); }} onClick={(e) => { e.stopPropagation(); onClose(); }} aria-label="Close magnifier">✕</button>
    </div>
  );
}
