import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

function emitPdfWorker() {
  return {
    name: "emit-pdf-worker-as-js",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "assets/pdf.worker.js",
        source: readFileSync(new URL("./node_modules/pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url)),
      });
    },
  };
}

export default defineConfig({ plugins: [react(), emitPdfWorker()], build: { outDir: "dist" } });
