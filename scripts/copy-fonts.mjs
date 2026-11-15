// Copies Excalidraw's hand-drawn fonts into public/fonts so the app never needs a font CDN.
// Xiaolai (the 12 MB CJK fallback) is skipped.
import { cpSync, rmSync, readdirSync } from "node:fs";
const src = "node_modules/@excalidraw/excalidraw/dist/prod/fonts", dst = "public/fonts";
rmSync(dst, { recursive: true, force: true });
for (const f of readdirSync(src)) if (f !== "Xiaolai") cpSync(`${src}/${f}`, `${dst}/${f}`, { recursive: true });
console.log("fonts copied");
