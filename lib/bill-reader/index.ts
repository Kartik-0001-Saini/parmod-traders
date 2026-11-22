/**
 * Bill Reader — public entry point.
 *
 *   import { parseBill } from "@/lib/bill-reader";
 *   import { createBillOcr } from "@/lib/bill-reader/ocr-tesseract"; // OCR engine (loads ~5 MB model)
 *
 * The OCR engine is imported separately so code that only parses (tests,
 * PDFs with real text) doesn't pull Tesseract into the bundle.
 */
export * from "./types";
export { parseBill } from "./parse-bill";
export { pdfTextToPage, isScannedPage } from "./pdf";
export type { PdfTextItem } from "./pdf";
export { productHints } from "./product-hints";
export { gstinChecksumOk, normalizeGstin, parseDate } from "./header-fields";
export { formatINR, parseAmount, inferGstRate } from "./numbers";
