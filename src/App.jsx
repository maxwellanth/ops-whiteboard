import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Excalidraw, CaptureUpdateAction, exportToSvg, exportToBlob, MainMenu, viewportCoordsToSceneCoords, getCommonBounds } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";
import { applyOp, mergeBoards, normalizeBoard, sortedProjects, snapshotHtml, statusView, ago, uid } from "./model.js";
import { buildManaged, isManaged } from "./scene.js";
import { ConflictError, AuthError } from "./ghstore.js";
import { detectConnection, saveCredentials, forgetToken, tokenTemplateUrl } from "./connection.js";
import { ProjectPanel, HistoryPanel, SetupScreen, SettingsPanel } from "./panels.jsx";

const clone = (x) => JSON.parse(JSON.stringify(x));
const draftKey = (repo) => "ow.draft." + repo;
const elSig = (els) => els.reduce((s, e) => s + e.version * 31 + (e.isDeleted ? 7 : 1), els.length);

export default function App({ initialConn }) {
  const [conn, setConn] = useState(initialConn);
  const [api, setApi] = useState(null);
  const [, force] = useState(0);
  const rerenderUi = () => force((n) => n + 1);
  const [pill, setPill] = useState({ kind: "loading", text: "Connecting…" });
  const [toast, setToast] = useState(null);
  const [panel, setPanel] = useState(null); // {type:'project', pid} | {type:'history'} | {type:'settings'}
  const [selectedPid, setSelectedPid] = useState(null);
  const [focusPid, setFocusPid] = useState(null); // last project zoomed to from a magnet
  // Phones open in "look" mode: no drawing toolbar over the board; pan/zoom with fingers, tap a project to read it.
  // The "draw" marker in the tray switches the full Excalidraw toolset on. Wide screens start in draw mode.
  const [drawMode, setDrawMode] = useState(() => window.innerWidth >= 700);
  const tapRef = useRef(null);
  const doc = useRef({ board: null, base: null, sha: null, commit: null, fetchedAt: null, rev: 0, savedRev: 0, msgs: [], pushing: false, generated: new Map(), manualSig: 0 });
  const timers = useRef({});

  const showToast = useCallback((text, kind = "info", ms = 6000) => { setToast({ text, kind }); clearTimeout(timers.current.toast); timers.current.toast = setTimeout(() => setToast(null), ms); }, []);

  // ---------- rendering data onto the canvas ----------
  const render = useCallback(() => {
    const d = doc.current;
    if (!api || !d.board) return;
    const { elements: managed, positions } = buildManaged(d.board);
    d.generated = new Map(managed.map((e) => [e.id, e.version]));
    d.genText = new Map(managed.filter((e) => e.type === "text").map((e) => [e.id, e.text]));
    d.genPos = positions;
    const manual = d.board.scene.elements.filter((e) => !isManaged(e));
    d.manualSig = elSig(manual);
    api.updateScene({ elements: [...manual, ...managed], captureUpdate: CaptureUpdateAction.NEVER });
  }, [api]);

  const updatePill = useCallback(() => {
    const d = doc.current;
    if (d.offline && d.cachedFrom && d.rev === d.savedRev) return setPill({ kind: "offline", text: `Offline · copy from ${ago(d.cachedFrom)}, may be out of date` });
    if (d.offline) return setPill({ kind: "offline", text: `Can't reach GitHub · edits kept on this device only (${ago(d.offline)})` });
    if (d.rev !== d.savedRev) return setPill({ kind: "local", text: d.pushing ? "Saving to GitHub…" : "Unsynced · saved on this device only" });
    setPill({ kind: "synced", text: `Saved in GitHub ${d.commit ? "· " + d.commit.slice(0, 7) : ""} · checked ${d.fetchedAt ? new Date(d.fetchedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "-"}` });
  }, []);

  const saveDraft = useCallback(() => {
    const d = doc.current;
    try { localStorage.setItem(draftKey(conn.repo), JSON.stringify({ board: d.board, base: d.base, sha: d.sha, savedAt: new Date().toISOString() })); } catch {}
  }, [conn]);

  // ---------- push with conflict merge ----------
  const push = useCallback(async () => {
    const d = doc.current;
    if (d.pushing || d.rev === d.savedRev || !conn?.store) return;
    d.pushing = true; updatePill();
    try {
      for (let attempt = 0; attempt < 4; attempt++) {
        const rev = d.rev, snapshot = clone(d.board), msgs = d.msgs.splice(0);
        const message = `[max] ${msgs.length ? [...new Set(msgs)].slice(0, 6).join("; ") : "whiteboard drawing edits"}`;
        try {
          const r = await conn.store.save(snapshot, d.sha, message);
          d.sha = r.sha; d.commit = r.commit; d.base = snapshot; d.savedRev = rev; d.offline = null; d.fetchedAt = new Date().toISOString();
          if (d.rev === d.savedRev) try { localStorage.removeItem(draftKey(conn.repo)); } catch {}
          break;
        } catch (e) {
          d.msgs.unshift(...msgs);
          if (!(e instanceof ConflictError)) throw e;
          const remote = await conn.store.load();
          const { board, conflicts } = mergeBoards(d.base, d.board, remote.board, "max");
          d.board = board; d.base = normalizeBoard(remote.board); d.sha = remote.sha; d.fetchedAt = remote.fetchedAt; d.rev++;
          render();
          showToast(conflicts.length ? `Someone else changed the board at the same time. Merged: your edits kept, ${conflicts.length} overlapping change(s) saved as notes on the card.` : "Merged with a newer change from another device or assistant.", conflicts.length ? "warn" : "info", 9000);
        }
      }
    } catch (e) {
      if (e instanceof AuthError) showToast(e.message, "error", 15000);
      else { d.offline = d.offline || new Date().toISOString(); clearTimeout(timers.current.retry); timers.current.retry = setTimeout(push, 15000); }
    } finally { d.pushing = false; updatePill(); rerenderUi(); }
  }, [conn, render, showToast, updatePill]);

  const markDirty = useCallback((msg) => {
    const d = doc.current;
    d.rev++; if (msg) d.msgs.push(msg);
    saveDraft(); updatePill();
    clearTimeout(timers.current.push); timers.current.push = setTimeout(push, 1800);
  }, [push, saveDraft, updatePill]);

  const doOp = useCallback((op) => {
    try { const msg = applyOp(doc.current.board, op, "max"); render(); markDirty(msg); rerenderUi(); return true; }
    catch (e) { showToast(e.message, "error"); return false; }
  }, [render, markDirty, showToast]);

  // ---------- load ----------

  const load = useCallback(async (initial) => {
    const d = doc.current;
    try {
      const remote = await conn.store.load();
      if (!remote.board) { setPill({ kind: "error", text: "No board.json in the repo yet. Run `board init` on the Mac." }); return; }
      d.fetchedAt = remote.fetchedAt; d.offline = null; d.cachedFrom = null;
      try { localStorage.setItem("ow.cache." + conn.repo, JSON.stringify({ board: remote.board, sha: remote.sha, fetchedAt: remote.fetchedAt })); } catch {}
      if (initial) {
        let draft = null; try { draft = JSON.parse(localStorage.getItem(draftKey(conn.repo)) || "null"); } catch {}
        d.base = normalizeBoard(remote.board); d.sha = remote.sha; d.board = clone(d.base);
        if (draft?.board) {
          d.board = draft.sha === remote.sha ? normalizeBoard(draft.board) : mergeBoards(draft.base, draft.board, remote.board, "max").board;
          d.rev++; d.msgs.push("edits restored from this device after reopening");
          showToast(`Restored unsynced edits saved on this device ${ago(draft.savedAt)}. Uploading now.`, "info", 8000);
          setTimeout(push, 500);
        }
        render();
        setTimeout(() => api?.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.95 }), 60);
      } else if (remote.sha !== d.sha) {
        if (d.rev === d.savedRev && !d.pushing) { d.base = normalizeBoard(remote.board); d.board = clone(d.base); d.sha = remote.sha; d.commit = null; render(); showToast(`Board updated: ${d.board.log[0]?.by || "someone"}: ${d.board.log[0]?.msg || ""}`, "info", 5000); }
        else push();
      }
      updatePill(); rerenderUi();
    } catch (e) {
      if (e instanceof AuthError) { setPill({ kind: "error", text: e.message }); return; }
      d.offline = d.offline || new Date().toISOString(); updatePill();
      if (initial) {
        let draft = null; try { draft = JSON.parse(localStorage.getItem(draftKey(conn.repo)) || "null"); } catch {}
        let cache = null; try { cache = JSON.parse(localStorage.getItem("ow.cache." + conn.repo) || "null"); } catch {}
        if (draft?.board) { d.board = normalizeBoard(draft.board); d.base = draft.base; d.sha = draft.sha; d.rev = 1; render(); showToast("Offline: showing the copy saved on this device. It is not confirmed in GitHub.", "warn", 10000); }
        else if (cache?.board) { d.board = normalizeBoard(cache.board); d.base = clone(d.board); d.sha = cache.sha; d.cachedFrom = cache.fetchedAt; render(); updatePill(); showToast(`Offline: showing the last copy this device downloaded (${ago(cache.fetchedAt)}). It may be out of date.`, "warn", 10000); }
      }
    }
  }, [api, conn, push, render, showToast, updatePill]);

  useEffect(() => {
    if (!api || !conn?.store) return;
    document.fonts?.ready?.then(() => doc.current.board && render());
    load(true);
    let lastMinute = 0;
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      load(false);
      const m = Math.floor(Date.now() / 60000), st = api.getAppState();
      if (m !== lastMinute && !st.newElement && !st.editingTextElement && !st.resizingElement && doc.current.rev === doc.current.savedRev) { lastMinute = m; render(); } // keeps "x min ago" and LIVE expiry honest
    };
    const iv = setInterval(tick, 20000);
    const vis = () => document.visibilityState === "visible" && load(false);
    document.addEventListener("visibilitychange", vis);
    return () => { clearInterval(iv); document.removeEventListener("visibilitychange", vis); };
  }, [api, conn]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- user edits on the canvas ----------
  const onChange = useCallback((elements, appState) => {
    const d = doc.current;
    if (!d.board) return;
    const manual = elements.filter((e) => !isManaged(e));
    const sig = elSig(manual);
    if (sig !== d.manualSig) { d.manualSig = sig; d.board.scene.elements = clone(manual); markDirty(); }
    const touched = elements.some((e) => isManaged(e) && d.generated.has(e.id) && d.generated.get(e.id) !== e.version);
    if (touched) {
      clearTimeout(timers.current.settle);
      timers.current.settle = setTimeout(() => {
        const els = api.getSceneElementsIncludingDeleted();
        let moved = false, edited = false;
        // Only a real drag counts as a move: compare with where we drew the card, and never save default positions.
        for (const p of Object.values(d.board.projects)) {
          const card = els.find((e) => e.id === `m:${p.id}:card`), g = d.genPos?.[p.id];
          if (card && !card.isDeleted && g && (Math.abs(card.x - g.x) > 1 || Math.abs(card.y - g.y) > 1)) { p.pos = { x: Math.round(card.x), y: Math.round(card.y) }; moved = true; }
        }
        // Only a real text change or a deletion counts as an edit; internal version bumps (font re-measuring) do not.
        edited = els.some((e) => isManaged(e) && d.genText?.has(e.id) && (e.isDeleted || e.text !== d.genText.get(e.id)));
        const deletedManaged = els.some((e) => isManaged(e) && d.generated.has(e.id) && e.isDeleted);
        if (moved || edited || deletedManaged) render();
        if (moved) markDirty("moved cards");
        if (edited && !moved) showToast("Cards are drawn from project data, so that change was undone. Tap the card, then Open card to edit it. Draw anywhere else freely.", "info", 8000);
      }, 700);
    }
    const g = (appState.selectedGroupIds && Object.keys(appState.selectedGroupIds).find((k) => k.startsWith("g:"))) || null;
    const sel = Object.keys(appState.selectedElementIds || {}).map((id) => elements.find((e) => e.id === id)).find((e) => e && isManaged(e) && e.customData.pid !== "_hq");
    const pid = g ? g.slice(2) : sel?.customData?.pid || null;
    setSelectedPid((cur) => (cur === pid ? cur : pid));
  }, [api, markDirty, render, showToast]);

  // ---------- tap a project island to open its details (works in look and draw mode) ----------
  const onCanvasPointerDown = (e) => { if (e.isPrimary) tapRef.current = { x: e.clientX, y: e.clientY, t: Date.now() }; };
  const onCanvasPointerUp = (e) => {
    const t = tapRef.current; tapRef.current = null;
    if (!t || !api || !e.isPrimary || Math.hypot(e.clientX - t.x, e.clientY - t.y) > 8 || Date.now() - t.t > 450) return;
    if (drawMode && api.getAppState().activeTool.type !== "selection") return; // don't hijack a drawing tool
    const st = api.getAppState();
    const { x, y } = viewportCoordsToSceneCoords({ clientX: e.clientX, clientY: e.clientY }, st);
    const byPid = {};
    for (const el of api.getSceneElements()) { const pid = el.customData?.pid; if (pid && pid !== "_hq" && pid !== "_" && el.customData.role !== "hub" && el.customData.role !== "rel") (byPid[pid] ||= []).push(el); }
    for (const [pid, els] of Object.entries(byPid)) {
      const [x1, y1, x2, y2] = getCommonBounds(els);
      if (x >= x1 && x <= x2 && y >= y1 && y <= y2 && doc.current.board?.projects[pid]) { setFocusPid(pid); setPanel({ type: "project", pid }); focus(pid, sheetPeekPx()); return; }
    }
  };

  // ---------- navigation and export ----------
  // Zoom to one project island. On phones, when the details sheet covers the bottom, fit the island into the visible top part.
  const focus = (pid, sheetPx = 0) => {
    const els = api.getSceneElements().filter((e) => e.customData?.pid === pid && e.customData.role !== "hub" && e.customData.role !== "rel");
    if (!els.length) return;
    if (!sheetPx) return api.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: 0.88, animate: true, duration: 450 });
    const vh = api.getAppState().height;
    api.scrollToContent(els, { fitToViewport: true, viewportZoomFactor: Math.max(0.3, (vh - sheetPx) / vh) * 0.92 });
    const st = api.getAppState();
    api.updateScene({ appState: { scrollY: st.scrollY - sheetPx / 2 / st.zoom.value }, captureUpdate: CaptureUpdateAction.NEVER });
  };
  const sheetPeekPx = () => (window.innerWidth < 700 ? Math.round(window.innerHeight * 0.46) : 0);
  const overview = () => api.scrollToContent(undefined, { fitToViewport: true, viewportZoomFactor: 0.92, animate: true, duration: 450 });

  const download = (blob, name) => { const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const snapshot = async (mode) => {
    const els = api.getSceneElements();
    const files = api.getFiles();
    if (mode === "png") { const blob = await exportToBlob({ elements: els, files, appState: { exportBackground: true, viewBackgroundColor: "#fdfcf8" }, mimeType: "image/png", exportPadding: 40 }); return download(blob, `ops-board-${stamp()}.png`); }
    const svg = await exportToSvg({ elements: els, files, appState: { exportBackground: true, viewBackgroundColor: "#ffffff" }, exportPadding: 30 });
    const html = snapshotHtml(doc.current.board, { svg: svg.outerHTML, source: `github:${conn.repo}`, fetchedAt: doc.current.fetchedAt });
    const blob = new Blob([html], { type: "text/html" });
    if (mode === "print") { const w = window.open(URL.createObjectURL(blob), "_blank"); if (w) setTimeout(() => { try { w.print(); } catch {} }, 900); else download(blob, `ops-board-${stamp()}.html`); }
    else download(blob, `ops-board-${stamp()}.html`);
    showToast("Snapshot saved to this device only. It is not in Drive. Use `board export --drive` on the Mac for a verified Drive copy.", "info", 9000);
  };

  const newProject = () => {
    const name = prompt("New project name?");
    if (!name) return;
    const id = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || uid("p");
    const revenue = confirm("Is this paid client work? (OK = paid, Cancel = internal / pipeline)") ? "paid" : "internal";
    if (doOp({ type: "newProject", pid: id, fields: { name, revenue, priority: revenue === "paid" ? 1 : 3 } })) setTimeout(() => { focus(id); setPanel({ type: "project", pid: id }); }, 100);
  };

  const restoreVersion = async (sha) => {
    const old = await conn.store.load(sha);
    if (!old.board) return showToast("That version has no board", "error");
    doc.current.board = normalizeBoard(old.board);
    render(); markDirty(`restored version ${sha.slice(0, 7)} (previous version stays in history)`); setPanel(null);
    showToast(`Restored ${sha.slice(0, 7)}. It will be saved as a new version, so nothing is lost.`);
  };

  // ---------- UI ----------
  if (!conn) return <div className="splash">Opening the whiteboard…</div>;
  if (conn.mode === "setup") return <SetupScreen repo={conn.repo} templateUrl={tokenTemplateUrl} onSave={async (repo, token) => { saveCredentials(repo, token); const c = await detectConnection(); try { await c.store.load(); setConn(c); return null; } catch (e) { forgetToken(); return e.message; } }} />;

  const d = doc.current;
  const projects = d.board ? sortedProjects(d.board) : [];
  return (
    <div className="shell">
      <header className="topline">
        <div className="brand" onClick={overview} title="Zoom out to the whole operation">Ops Whiteboard</div>
        <div className={"pill " + pill.kind} title={pill.text}>{pill.text}</div>
        <button className="gear" onClick={() => setPanel({ type: "settings" })} aria-label="Connection and privacy" title="Connection and privacy">⚙</button>
      </header>
      <div className="chips" aria-label="Projects">
        {projects.map((p) => (
          <button key={p.id} className={"chip " + p.revenue + (selectedPid === p.id ? " on" : "")} onClick={() => { setFocusPid(p.id); setPanel({ type: "project", pid: p.id }); focus(p.id, sheetPeekPx()); }}>
            <i className="magnet" />{p.revenue === "paid" ? "$ " : ""}{p.name.replace(/^DEMO · /, "")}{p.demo ? " (demo)" : ""}
            {p.decisions.length ? <span className="badge dec">{p.decisions.length}?</span> : null}
            {p.blockers.length ? <span className="badge blk">{p.blockers.length}✕</span> : null}
            {p.agents.some((a) => statusView(a.status).tone === "live") ? <span className="badge live">●</span> : null}
          </button>
        ))}
      </div>
      <div className="board-frame">
      <main className={"canvas" + (drawMode ? " drawing" : " looking")} onPointerDownCapture={onCanvasPointerDown} onPointerUpCapture={onCanvasPointerUp}>
        <Excalidraw excalidrawAPI={setApi} onChange={onChange} name="Ops Whiteboard" theme="light" viewModeEnabled={!drawMode}
          initialData={{ elements: [], appState: { viewBackgroundColor: "#ffffff", currentItemFontFamily: 5, currentItemRoughness: 2, currentItemStrokeWidth: 2, currentItemStrokeColor: "#1c4fa1" } }}
          UIOptions={{ canvasActions: { loadScene: false, saveToActiveFile: false, export: false, saveAsImage: false, clearCanvas: false, toggleTheme: false, changeViewBackgroundColor: false } }}>
          <MainMenu><MainMenu.DefaultItems.Help /></MainMenu>
        </Excalidraw>
        <div className="sheen" aria-hidden="true" />
        {(() => { const pid = selectedPid || focusPid; const p = pid && d.board?.projects[pid]; return p && panel?.pid !== pid ? (
          <button className="open-card" onClick={() => { setPanel({ type: "project", pid }); focus(pid, sheetPeekPx()); }}>✏️ details &amp; edit: {p.name.replace(/^DEMO · /, "")}</button>) : null; })()}
      </main>
      </div>
      <nav className="tray" aria-label="Board tools">
        <button className="marker black" onClick={() => { overview(); setFocusPid(null); }} title="Zoom out to the whole operation"><span>all</span></button>
        <button className={"marker purple" + (drawMode ? " on" : "")} onClick={() => setDrawMode((m) => !m)} aria-pressed={drawMode} title={drawMode ? "Hide drawing tools" : "Draw on the board"}><span>{drawMode ? "✓ done" : "✎ draw"}</span></button>
        <button className="marker blue" onClick={newProject} title="New project"><span>+ new</span></button>
        <details className="menu"><summary className="marker green" title="Snapshot / export"><span>save</span></summary>
          <div className="menu-pop">
            <button onClick={() => snapshot("html")}>Readable snapshot (.html)</button>
            <button onClick={() => snapshot("print")}>Printable view</button>
            <button onClick={() => snapshot("png")}>Board picture (.png)</button>
            <p className="fine">Files go to this device. Drive copies are made from the Mac with <code>board export --drive</code>, which checks the file arrived.</p>
          </div></details>
        <button className="marker red" onClick={() => setPanel({ type: "history" })} title="History and restore"><span>history</span></button>
      </nav>
      {panel?.type === "project" && d.board?.projects[panel.pid] && <ProjectPanel p={d.board.projects[panel.pid]} all={d.board.projects} log={d.board.log} doOp={doOp} onClose={() => setPanel(null)} onFocus={() => focus(panel.pid)} />}
      {panel?.type === "history" && <HistoryPanel store={conn.store} log={d.board?.log || []} onRestore={restoreVersion} onClose={() => setPanel(null)} />}
      {panel?.type === "settings" && <SettingsPanel conn={conn} onClose={() => setPanel(null)} onForget={() => { forgetToken(); location.reload(); }} />}
      {toast && <div className={"toast " + toast.kind} onClick={() => setToast(null)}>{toast.text}</div>}
    </div>
  );
}
