/**
 * Read every bill in a folder and report what the Bill Reader understood.
 *
 *   npm run bills:read                       # reads ./testbill
 *   npm run bills:read -- "D:\bills\nov"     # any folder
 *   npm run bills:read -- testbill --verbose # also print the raw OCR rows
 *   npm run bills:read -- testbill --cached  # re-parse saved OCR words (no OCR; for parser work)
 *
 * Supports .jpg .jpeg .png .webp .tif .tiff .pdf (digital or scanned).
 * Files/folders starting with "_" are skipped.
 *
 * For each bill it prints the header, the item lines, the checks, and writes:
 *   <folder>/results/<bill>.json      — what was parsed (send this back for debugging)
 *   <folder>/results/<bill>.ocr.json  — the raw OCR words
 *
 * If <bill>.expected.json exists next to the bill, the result is compared with
 * it and a score is printed (see docs/BILL_READER.md for the format).
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { createCanvas } from "@napi-rs/canvas";
import { parseBill, pdfTextToPage, isScannedPage, formatINR } from "../lib/bill-reader";
import type { OcrPage, ParsedBill, PdfTextItem } from "../lib/bill-reader";
import { createBillOcr, BillOcr } from "../lib/bill-reader/ocr-tesseract";
import { GrayImage, toGray } from "../lib/bill-reader/image";
import { OcrEngine, PageReadInfo, extractText, prepareImage } from "../lib/bill-reader/pipeline";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"]);
const PDF_TEXT_SCALE = 3; // coordinate scale for digital-PDF text

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** Tesseract (Node) as the pipeline's OCR engine: grey pixels → PNG → words. */
function nodeEngine(ocr: BillOcr): OcrEngine {
  return {
    async recognize(img: GrayImage, onProgress) {
      const png = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
        raw: { width: img.width, height: img.height, channels: 1 },
      })
        .png()
        .toBuffer();
      return ocr.recognize(png, { width: img.width, height: img.height }, onProgress);
    },
  };
}

interface ReadResult {
  pages: OcrPage[];
  info: (PageReadInfo | null)[];
}

/** Same steps the app runs: which way up → text size → OCR. */
async function readGray(gray: GrayImage, engine: OcrEngine): Promise<{ page: OcrPage; info: PageReadInfo }> {
  const prepared = await prepareImage(gray, engine);
  return { page: await extractText(prepared, engine), info: prepared.info };
}

async function readImage(file: string, engine: OcrEngine): Promise<ReadResult> {
  // .rotate() applies the phone's EXIF orientation, like the browser does.
  const { data, info } = await sharp(file).rotate().raw().toBuffer({ resolveWithObject: true });
  const r = await readGray(toGray(data, info.width, info.height, info.channels), engine);
  return { pages: [r.page], info: [r.info] };
}

async function readPdf(file: string, engine: OcrEngine): Promise<ReadResult> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const data = new Uint8Array(fs.readFileSync(file));
  const task = pdfjs.getDocument({ data });
  const doc = await task.promise;
  const result: ReadResult = { pages: [], info: [] };
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const textViewport = page.getViewport({ scale: PDF_TEXT_SCALE });
    const text = await page.getTextContent();
    const items = text.items.filter((i): i is PdfTextItem & typeof i => "str" in i);
    const textPage = pdfTextToPage(items as PdfTextItem[], textViewport, PDF_TEXT_SCALE);
    if (!isScannedPage(textPage)) {
      result.pages.push(textPage);
      result.info.push(null);
      continue;
    }
    // Scanned page / photo saved as PDF: render at the embedded photo's own resolution
    // (no detail is lost, none is invented), then read it like a photo.
    const scale = await pdfImageScale(pdfjs, page);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvas: canvas as unknown as HTMLCanvasElement, viewport }).promise;
    const rgba = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const r = await readGray(toGray(rgba.data, canvas.width, canvas.height, 4), engine);
    result.pages.push(r.page);
    result.info.push(r.info);
  }
  await task.destroy(); // pdf.js 6: destroy lives on the loading task
  return result;
}

/** Render scale that shows the page's largest embedded image at 1:1 (between 1.5× and 4×). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function pdfImageScale(pdfjs: any, page: any): Promise<number> {
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

// ---------------------------------------------------------------------------
// Expected-result comparison (optional <bill>.expected.json)
// ---------------------------------------------------------------------------

interface Expected {
  header?: Partial<Record<keyof ParsedBill["header"], string | null>>;
  lines?: { description?: string; hsn?: string; quantity?: number; rateExclTax?: number; rateInclTax?: number; amount?: number }[];
  totals?: Partial<Record<keyof ParsedBill["totals"], number>>;
}

const norm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, " ").trim();

function editDistance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}

/** Descriptions and names: a letter or two misread still counts (≥ 90% the same). */
const FUZZY_FIELDS = new Set(["description", "supplierName", "buyerName"]);
function textMatches(field: string, got: unknown, want: unknown): boolean {
  const g = norm(got);
  const w = norm(want);
  if (g === w) return true;
  if (!FUZZY_FIELDS.has(field) || !g) return false;
  return 1 - editDistance(g, w) / Math.max(g.length, w.length) >= 0.9;
}

function compare(parsed: ParsedBill, expected: Expected): { correct: number; total: number; misses: string[] } {
  let correct = 0;
  let total = 0;
  const misses: string[] = [];
  const check = (label: string, got: unknown, want: unknown) => {
    if (want === undefined) return;
    total++;
    const field = label.split(".").pop() ?? "";
    const ok = typeof want === "number" ? typeof got === "number" && Math.abs(got - want) < 0.011 : textMatches(field, got, want);
    if (ok) correct++;
    else misses.push(`${label}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
  };
  for (const [k, v] of Object.entries(expected.header ?? {})) check(`header.${k}`, parsed.header[k as keyof ParsedBill["header"]], v);
  (expected.lines ?? []).forEach((want, i) => {
    const got = parsed.lines[i];
    for (const [k, v] of Object.entries(want)) check(`line ${i + 1}.${k}`, got ? got[k as keyof typeof got] : undefined, v);
  });
  if (expected.lines && parsed.lines.length !== expected.lines.length) {
    total++;
    misses.push(`line count: expected ${expected.lines.length}, got ${parsed.lines.length}`);
  } else if (expected.lines) {
    total++;
    correct++;
  }
  for (const [k, v] of Object.entries(expected.totals ?? {})) check(`totals.${k}`, parsed.totals[k as keyof ParsedBill["totals"]], v);
  return { correct, total, misses };
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const pad = (s: unknown, n: number) => {
  const t = String(s ?? "");
  return t.length > n ? t.slice(0, n - 1) + "…" : t.padEnd(n);
};
const padL = (s: unknown, n: number) => String(s ?? "").padStart(n);

function printBill(name: string, bill: ParsedBill, seconds: number): void {
  const h = bill.header;
  console.log(`\n${"═".repeat(100)}\n${name}   (${bill.source === "pdf-text" ? "PDF text" : "OCR"}, ${bill.pageCount} page(s), ${seconds.toFixed(1)} s)\n${"═".repeat(100)}`);
  console.log(`Supplier : ${h.supplierName ?? "?"}   GSTIN ${h.supplierGstin ?? "?"}`);
  console.log(`Buyer    : ${h.buyerName ?? "?"}   GSTIN ${h.buyerGstin ?? "?"}`);
  console.log(`Invoice  : ${h.invoiceNumber ?? "?"}   Date ${h.invoiceDate ?? "?"}   IRN ${h.irn ? h.irn.slice(0, 12) + "…" : "—"}`);
  console.log(`Columns  : ${bill.columns.map((c) => c.role).join(" | ") || "(heading not found)"}`);
  console.log(
    `\n${pad("#", 3)} ${pad("Description", 30)} ${pad("HSN", 9)} ${padL("Qty", 8)} ${padL("Rate", 11)} ${padL("Rate+Tax", 11)} ${padL("GST", 4)} ${padL("Amount", 12)}  Notes`
  );
  for (const l of bill.lines) {
    const notes = [...l.autoFixed.map((f) => `fixed: ${f}`), ...l.flags].join("; ");
    console.log(
      `${pad(l.lineNo, 3)} ${pad(l.description, 30)} ${pad(l.hsn ?? "?", 9)} ${padL(`${l.quantity ?? "?"} ${l.unit ?? ""}`.trim(), 8)} ` +
        `${padL(formatINR(l.rateExclTax), 11)} ${padL(formatINR(l.rateInclTax), 11)} ${padL(l.gstRate !== null ? l.gstRate + "%" : "", 4)} ` +
        `${padL(formatINR(l.amount), 12)}  ${notes || "OK"}`
    );
  }
  const t = bill.totals;
  console.log(
    `\nTotals   : qty ${t.totalQuantity ?? "—"} | sub-total ${formatINR(t.subtotal)} | CGST ${formatINR(t.cgst)} | SGST ${formatINR(t.sgst)} | IGST ${formatINR(t.igst)} | grand total ${formatINR(t.grandTotal)}`
  );
  for (const c of bill.checks) console.log(`  ${c.ok ? "✔" : "✘"} ${c.name}: ${c.detail}`);
  for (const w of bill.warnings) console.log(`  ! ${w}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const verbose = args.includes("--verbose");
  // --cached: re-parse the OCR words saved by an earlier run (results/<bill>.ocr.json) instead of
  // reading the photos again. Parser changes can be checked in seconds.
  const cached = args.includes("--cached");
  const folder = path.resolve(args.find((a) => !a.startsWith("--")) ?? "testbill");
  if (!fs.existsSync(folder)) {
    console.error(`Folder not found: ${folder}`);
    process.exit(1);
  }
  const outDir = path.join(folder, "results");
  fs.mkdirSync(outDir, { recursive: true });

  const files = fs
    .readdirSync(folder, { withFileTypes: true })
    .filter((d) => d.isFile() && !d.name.startsWith("_") && !d.name.startsWith("."))
    .map((d) => d.name)
    .filter((n) => IMAGE_EXT.has(path.extname(n).toLowerCase()) || path.extname(n).toLowerCase() === ".pdf")
    .sort();
  if (files.length === 0) {
    console.error(`No bill images or PDFs in ${folder}`);
    process.exit(1);
  }

  const cachePath = path.resolve("node_modules/.cache/bill-reader");
  fs.mkdirSync(cachePath, { recursive: true });
  console.log(`Reading ${files.length} bill(s) from ${folder}\n(first run downloads the ~5 MB English OCR model)`);
  const ocr = await createBillOcr({ cachePath });
  const engine = nodeEngine(ocr);

  const summary: string[] = [];
  let allCorrect = 0;
  let allTotal = 0;
  for (const file of files) {
    const full = path.join(folder, file);
    const name = path.basename(file, path.extname(file));
    const started = Date.now();
    try {
      const cachedOcr = path.join(outDir, `${name}.ocr.json`);
      const read: ReadResult =
        cached && fs.existsSync(cachedOcr)
          ? { pages: JSON.parse(fs.readFileSync(cachedOcr, "utf8")), info: [] }
          : path.extname(file).toLowerCase() === ".pdf"
            ? await readPdf(full, engine)
            : await readImage(full, engine);
      const pages = read.pages;
      const bill = parseBill(pages);
      const seconds = (Date.now() - started) / 1000;
      printBill(file, bill, seconds);
      read.info.forEach((info, i) => {
        if (!info) return;
        const scores = Object.entries(info.orientationScores).map(([turn, n]) => `${turn}°:${n}`).join(" ");
        console.log(
          `Page ${i + 1}   : turned ${info.rotation}°, text ${info.textHeight?.toFixed(1) ?? "?"} px → resized ×${info.scale.toFixed(2)}  (readable words ${scores})`
        );
      });

      if (verbose) {
        const { cleanWords, groupRows, medianHeight, rowText } = await import("../lib/bill-reader/layout");
        for (const p of pages) {
          const words = cleanWords(p.words);
          console.log("\n--- OCR rows ---");
          for (const r of groupRows(words, medianHeight(words))) console.log(`${padL(Math.round(r.y), 5)} | ${rowText(r)}`);
        }
      }

      fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify({ file, seconds, pages: read.info, bill }, null, 2));
      fs.writeFileSync(path.join(outDir, `${name}.ocr.json`), JSON.stringify(pages));

      let score = "";
      const expectedFile = path.join(folder, `${name}.expected.json`);
      if (fs.existsSync(expectedFile)) {
        const result = compare(bill, JSON.parse(fs.readFileSync(expectedFile, "utf8")));
        score = `${result.correct}/${result.total}`;
        allCorrect += result.correct;
        allTotal += result.total;
        console.log(`\nExpected-result score: ${score}`);
        for (const m of result.misses) console.log(`  ✘ ${m}`);
      }
      const flagged = bill.lines.filter((l) => l.flags.length > 0).length;
      const checksOk = bill.checks.filter((c) => c.ok).length;
      summary.push(
        `${pad(file, 40)} ${padL(bill.lines.length, 5)} ${padL(flagged, 7)} ${padL(`${checksOk}/${bill.checks.length}`, 7)} ${padL(score || "—", 7)} ${padL(seconds.toFixed(1), 6)}`
      );
    } catch (err) {
      console.error(`\n✘ ${file}: ${(err as Error).message}`);
      summary.push(`${pad(file, 40)} ERROR: ${(err as Error).message}`);
    }
  }
  await ocr.terminate();

  console.log(`\n${"═".repeat(100)}\nSUMMARY\n${pad("Bill", 40)} ${padL("Lines", 5)} ${padL("Flagged", 7)} ${padL("Checks", 7)} ${padL("Score", 7)} ${padL("Sec", 6)}`);
  for (const s of summary) console.log(s);
  if (allTotal > 0) console.log(`\nAll scored fields: ${allCorrect}/${allTotal} (${((100 * allCorrect) / allTotal).toFixed(1)}%)`);
  console.log(`\nResults saved in ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
