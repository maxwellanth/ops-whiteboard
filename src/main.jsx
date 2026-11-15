import { createRoot } from "react-dom/client";
import App from "./App.jsx";
import "./app.css";

// Self-hosted hand-drawn fonts (copied into ./fonts at build time), so nothing loads from a third-party CDN.
window.EXCALIDRAW_ASSET_PATH = new URL(import.meta.env.BASE_URL, location.href).href;
createRoot(document.getElementById("root")).render(<App />);
