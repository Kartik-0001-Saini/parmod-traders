/**
 * Browser side of the bill reader: turns uploaded photos / PDFs into pages and runs
 * Tesseract in the browser (free — nothing is sent to an AI service).
 *
 * Only import this from client components, with a dynamic import, so the OCR engine
 * and pdf.js load only when a bill is actually being read:
 *   const { createBrowserEngine, fileToSources } = await import("@/lib/bill-reader/browser");
 */
import { createBillOcr } from "./ocr-tesseract";
import { GrayImage, toGray, toRgba } from "./image";
import { isScannedPage, pdfTextToPage, PdfTextItem } from "./pdf";
import { OcrEngine } from "./pipeline";
import { PageSource } from "./read-bill";

/** Photos bigger than this (long side, px) are shrunk while decoding — enough detail, less memory. */
const MAX_DECODE_SIDE = 4000;
const PDF_TEXT_SCALE = 3;

export interface BrowserEngine {
  engine: OcrEngine;
  terminate(): Promise<void>;
}

/** Tesseract in a web worker. The first use downloads the ~10 MB English model (cached after). */
export async function createBrowserEngine(): Promise<BrowserEngine> {
  const ocr = await createBillOcr();
  return {
    engine: {
      async recognize(img: GrayImage, onProgress) {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("This browser cannot process images (no canvas).");
        ctx.putImageData(new ImageData(toRgba(img), img.width, img.height), 0, 0);
        try {
          return await ocr.recognize(canvas, { width: img.width, height: img.height }, onProgress);
        } finally {
          canvas.width = 0; // free the memory now (phones)
          canvas.height = 0;
        }
      },
    },
    terminate: () => ocr.terminate(),
  };
}

function isPdf(file: Blob, name: string): boolean {
  return file.type === "application/pdf" || /\.pdf$/i.test(name);
}

/** One uploaded file → its pages (a photo is one page; a PDF can be several). */
export async function fileToSources(file: Blob, name: string): Promise<PageSource[]> {
  return isPdf(file, name) ? pdfToSources(file) : [await imageToSource(file)];
}

async function imageToSource(file: Blob): Promise<PageSource> {
  // imageOrientation "from-image" applies the phone's EXIF rotation.
  const probe = await createImageBitmap(file, { imageOrientation: "from-image" });
  let { width, height } = probe;
  let bitmap = probe;
  const long = Math.max(width, height);
  if (long > MAX_DECODE_SIDE) {
    const k = MAX_DECODE_SIDE / long;
    width = Math.round(width * k);
    height = Math.round(height * k);
    probe.close();
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image", resizeWidth: width, resizeHeight: height, resizeQuality: "high" });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser cannot process images (no canvas).");
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const rgba = ctx.getImageData(0, 0, width, height);
  canvas.width = 0;
  canvas.height = 0;
  return { kind: "image", image: toGray(rgba.data, width, height, 4) };
}

async function pdfToSources(file: Blob): Promise<PageSource[]> {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const out: PageSource[] = [];
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const textViewport = page.getViewport({ scale: PDF_TEXT_SCALE });
      const text = await page.getTextContent();
      const items = text.items.filter((i): i is PdfTextItem & typeof i => "str" in i);
      const textPage = pdfTextToPage(items as PdfTextItem[], textViewport, PDF_TEXT_SCALE);
      if (!isScannedPage(textPage)) {
        // A digital PDF: the exact text, no OCR needed.
        out.push({ kind: "text", page: textPage });
        continue;
      }
      // A photo or scan inside a PDF: render it at the photo's own resolution and OCR it.
      const scale = await embeddedImageScale(pdfjs, page);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error("This browser cannot process images (no canvas).");
      ctx.fillStyle = "#fff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height);
      out.push({ kind: "image", image: toGray(rgba.data, canvas.width, canvas.height, 4) });
      canvas.width = 0;
      canvas.height = 0;
    }
  } finally {
    await task.destroy();
  }
  return out;
}

/** Render scale that shows the page's largest embedded image at 1:1 (between 1.5× and 4×). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function embeddedImageScale(pdfjs: any, page: any): Promise<number> {
  const base = page.getViewport({ scale: 1 });
  const ops = await page.getOperatorList();
  let widest = 0;
  for (let i = 0; i < ops.fnArray.length; i++) {
    if (ops.fnArray[i] !== pdfjs.OPS.paintImageXObject) continue;
    const name = ops.argsArray[i][0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const img: any = await new Promise((resolve) => page.objs.get(name, resolve));
    widest = Math.max(widest, Math.max(img?.width ?? 0, img?.height ?? 0) / Math.max(base.width, base.height));
  }
  return widest > 0 ? Math.min(4, Math.max(1.5, widest)) : 3;
}
