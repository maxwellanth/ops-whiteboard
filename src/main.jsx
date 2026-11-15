import { createRoot } from "react-dom/client";
import { lazy, Suspense, useEffect, useState } from "react";
import "./app.css";
import { detectConnection, saveCredentials, forgetToken, tokenTemplateUrl } from "./connection.js";
import { SetupScreen } from "./panels.jsx";

// Self-hosted hand-drawn fonts (copied into ./fonts at build time), so nothing loads from a third-party CDN.
window.EXCALIDRAW_ASSET_PATH = new URL(import.meta.env.BASE_URL, location.href).href;

// The drawing engine is the heavy part. It loads only once we know there is a board to show,
// so the setup screen and the splash appear immediately.
const App = lazy(() => import("./App.jsx"));
const Splash = ({ text = "Opening the whiteboard…" }) => <div className="splash"><img src="./icon.svg" alt="" width="72" height="72" /><p>{text}</p></div>;

function Root() {
  const [conn, setConn] = useState(null);
  useEffect(() => { detectConnection().then(setConn); import("./App.jsx"); }, []); // start fetching the app code in parallel
  if (!conn) return <Splash />;
  if (conn.mode === "setup") return <SetupScreen repo={conn.repo} templateUrl={tokenTemplateUrl} onSave={async (repo, token) => {
    saveCredentials(repo, token);
    const c = await detectConnection();
    try { await c.store.load(); setConn(c); return null; } catch (e) { forgetToken(); return e.message; }
  }} />;
  return <Suspense fallback={<Splash text="Loading the board…" />}><App initialConn={conn} /></Suspense>;
}

createRoot(document.getElementById("root")).render(<Root />);

// Service worker: caches the app shell (code, fonts, icons) so the app opens fast and opens offline.
// It never caches board data or GitHub API calls. Only on HTTPS (the published site), not on the Mac proxy.
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("./sw.js").catch(() => {});
