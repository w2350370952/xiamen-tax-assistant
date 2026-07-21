import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import PdfWorker from "pdfjs-dist/build/pdf.worker.mjs?worker";
import { parseExtractedPages } from "./pdf-parser-core";

// Let Vite bundle the PDF worker as a regular worker asset. EdgeOne serves raw
// .mjs assets as application/octet-stream, which browsers reject as modules.
GlobalWorkerOptions.workerPort = new PdfWorker();

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
