import { Resvg } from "@resvg/resvg-js";
import { fileURLToPath } from "node:url";
import path from "node:path";

// src/render.ts -> ../fonts and dist/render.js -> ../fonts both land on the repo-root fonts/ dir.
const FONT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "fonts");
const FONT_FILES = ["JetBrainsMono-Regular.ttf", "JetBrainsMono-Bold.ttf", "ArchivoBlack-Regular.ttf"].map((f) => path.join(FONT_DIR, f));

export function renderPng(svg: string): Buffer {
  const resvg = new Resvg(svg, {
    font: { fontFiles: FONT_FILES, loadSystemFonts: false, defaultFontFamily: "JetBrains Mono" },
    fitTo: { mode: "original" },
  });
  return resvg.render().asPng();
}
