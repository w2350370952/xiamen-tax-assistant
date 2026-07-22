import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

function emitRuntimeAssets() {
  return {
    name: "emit-local-runtime-assets",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "assets/pdf.worker.js",
        source: readFileSync(new URL("./node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)),
      });
      this.emitFile({
        type: "asset",
        fileName: "assets/ocr/worker.min.js",
        source: readFileSync(new URL("./node_modules/tesseract.js/dist/worker.min.js", import.meta.url)),
      });
      this.emitFile({
        type: "asset",
        fileName: "assets/ocr/tesseract-core-lstm.wasm.js",
        source: readFileSync(new URL("./node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js", import.meta.url)),
      });
      this.emitFile({
        type: "asset",
        fileName: "assets/ocr/chi_sim.traineddata.gz",
        source: readFileSync(new URL("./node_modules/@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz", import.meta.url)),
      });
    },
  };
}

export default defineConfig({ plugins: [react(), emitRuntimeAssets()], build: { outDir: "dist" } });
