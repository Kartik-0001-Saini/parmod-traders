/**
 * PDF helpers (environment-neutral).
 *
 * Digital PDFs (from Tally/billing software) contain real text: read it
 * directly — exact, no OCR errors. Scanned PDFs contain only a picture: the
 * caller renders the page to an image and sends it through OCR instead.
 *
 * Loading/rendering pdf.js differs between Node and the browser, so that part
 * lives with the caller (scripts/test-bills.ts now, the app later). This file
 * only converts pdf.js text items into OcrWords.
 */
import { OcrPage, OcrWord } from "./types";

/** The fields of a pdf.js TextItem that we use. */
export interface PdfTextItem {
  str: string;
  transform: number[];
  width: number;
  height: number;
}

/** pdf.js Util.transform: multiply two 2D affine matrices. */
function multiply(m1: number[], m2: number[]): number[] {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

/**
 * Convert a page's text items to OcrWords in top-left pixel coordinates.
 * @param viewportTransform  page.getViewport({ scale }).transform
 * @param scale              the same scale
 */
export function pdfTextToPage(
  items: PdfTextItem[],
  viewport: { transform: number[]; width: number; height: number },
  scale: number
): OcrPage {
  const words: OcrWord[] = [];
  for (const item of items) {
    if (!item.str || !item.str.trim()) continue;
    const m = multiply(viewport.transform, item.transform);
    const fontHeight = Math.hypot(m[2], m[3]) || item.height * scale;
    const x = m[4];
    const baseline = m[5];
    const totalWidth = item.width * scale;
    // pdf.js items are often whole phrases: split into words, spacing by character count.
    const parts = item.str.split(/(\s+)/);
    const charWidth = totalWidth / Math.max(1, item.str.length);
    let offset = 0;
    for (const part of parts) {
      if (part.trim()) {
        words.push({
          text: part,
          conf: 100,
          x0: x + offset * charWidth,
          x1: x + (offset + part.length) * charWidth,
          y0: baseline - fontHeight,
          y1: baseline + fontHeight * 0.2,
        });
      }
      offset += part.length;
    }
  }
  return { words, width: viewport.width, height: viewport.height, source: "pdf-text" };
}

/** A page with almost no text is a scan/photo inside a PDF → needs OCR. */
export function isScannedPage(page: OcrPage): boolean {
  const chars = page.words.reduce((n, w) => n + w.text.length, 0);
  return chars < 40;
}
