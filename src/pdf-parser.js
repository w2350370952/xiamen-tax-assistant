import { getDocument } from "pdfjs-dist";
import { WorkerMessageHandler } from "pdfjs-dist/build/pdf.worker.mjs";
import { parseExtractedPages } from "./pdf-parser-core";

// EdgeOne serves standalone .mjs assets as application/octet-stream. Bundle the
// handler into this module so PDF.js can use its in-page worker fallback without
// downloading a separate module that the browser would reject.
globalThis.pdfjsWorker = { WorkerMessageHandler };

export async function parseCoursePdf(file, onProgress = () => {}) {
  const data = new Uint8Array(await file.arrayBuffer());
  const document = await getDocument({ data }).promise;
  const pages = [];
  for (let index = 1; index <= document.numPages; index += 1) {
    onProgress(Math.round((index / document.numPages) * 80));
    const page = await document.getPage(index);
    const content = await page.getTextContent();
    pages.push({
      pageNumber: index,
      items: content.items.filter((item) => "str" in item).map((item) => ({
        str: item.str,
        x: item.transform[4],
        y: item.transform[5],
      })),
    });
  }
  const result = parseExtractedPages(pages);
  onProgress(100);
  return result;
}
