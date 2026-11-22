/**
 * The whole read of a bill, step by step. Used by the app (in the browser) and by
 * scripts/test-bills.ts (in Node), so both behave the same.
 *
 *   1. prepareAll()  — "Reading the image": which way up is each page, how big is the text
 *   2. extractAll()  — "Extracting the text": OCR each page, then zoom in on the item table
 *   3. understand()  — "Understanding the bill": columns, lines, arithmetic, totals
 *
 * The caller decodes files into pages (GrayImage for photos / scanned PDFs, OcrPage for
 * digital PDFs) and supplies the OCR engine.
 */
import { GrayImage } from "./image";
import { OcrEngine, PageReadInfo, PreparedImage, StepCallbacks, ZoomedRead, extractText, prepareImage, zoomTable } from "./pipeline";
import { ParseOptions, parseBill } from "./parse-bill";
import { OcrPage, OcrWord, ParsedBill } from "./types";

export type PageSource = { kind: "image"; image: GrayImage } | { kind: "text"; page: OcrPage };

export type PreparedPage = { kind: "image"; prepared: PreparedImage } | { kind: "text"; page: OcrPage };

export interface PageCallbacks extends StepCallbacks {
  /** Called when work on a page starts (0-based). */
  onPage?: (pageIndex: number, pageCount: number) => void;
}

export async function prepareAll(sources: PageSource[], engine: OcrEngine, cb: PageCallbacks = {}): Promise<PreparedPage[]> {
  const out: PreparedPage[] = [];
  for (let i = 0; i < sources.length; i++) {
    cb.onPage?.(i, sources.length);
    const src = sources[i];
    if (src.kind === "text") {
      out.push(src);
      continue;
    }
    out.push({
      kind: "image",
      prepared: await prepareImage(src.image, engine, {
        onStatus: cb.onStatus,
        onProgress: (f) => cb.onProgress?.((i + f) / sources.length),
      }),
    });
  }
  return out;
}

export interface ExtractResult {
  pages: OcrPage[];
  info: (PageReadInfo | null)[];
}

export async function extractAll(
  prepared: PreparedPage[],
  engine: OcrEngine,
  options: ParseOptions = {},
  cb: PageCallbacks = {}
): Promise<ExtractResult> {
  const pages: OcrPage[] = [];
  const info: (PageReadInfo | null)[] = [];
  for (let i = 0; i < prepared.length; i++) {
    cb.onPage?.(i, prepared.length);
    const p = prepared[i];
    if (p.kind === "text") {
      pages.push(p.page);
      info.push(null);
      continue;
    }
    const progress = (from: number, to: number) => (f: number) => cb.onProgress?.((i + from + (to - from) * f) / prepared.length);
    let page = await extractText(p.prepared, engine, { onStatus: cb.onStatus, onProgress: progress(0, 0.6) });
    // Find the item table on this page, then read it again enlarged.
    const quick = parseBill([page], options);
    const region = quick.tableRegions[0];
    if (region) {
      const zoom = await zoomTable(p.prepared, page, region, engine, { onStatus: cb.onStatus, onProgress: progress(0.6, 1) });
      if (zoom) page = bestOfReads(page, zoom, region.itemsEnd, options);
    }
    cb.onProgress?.((i + 1) / prepared.length);
    pages.push(page);
    info.push(p.prepared.info);
  }
  return { pages, info };
}

export function understand(pages: OcrPage[], options: ParseOptions = {}): ParsedBill {
  return parseBill(pages, options);
}

/** How much a parse "checks out": clean lines and passing totals checks, failed checks cost. */
function readScore(bill: ParsedBill): number {
  let s = 0;
  for (const l of bill.lines) s += l.flags.length === 0 ? 1 : 0.3;
  for (const c of bill.checks) s += c.ok ? 1.5 : -1;
  for (const v of Object.values(bill.totals)) if (v !== null) s += 0.2;
  // A readable heading labels the columns (e.g. which rate includes tax).
  if (bill.columns.length > 0) s += 1;
  return s;
}

/**
 * The page read and the zoomed table read each misread different things. Try the item rows
 * from either read with the totals from either read, and keep the combination that checks out.
 */
function bestOfReads(page: OcrPage, zoom: ZoomedRead, itemsEnd: number, options: ParseOptions): OcrPage {
  const cy = (w: OcrWord) => (w.y0 + w.y1) / 2;
  const inStrip = (w: OcrWord) => cy(w) >= zoom.top && cy(w) <= zoom.bottom;
  const outside = page.words.filter((w) => !inStrip(w));
  const pageItems = page.words.filter((w) => inStrip(w) && cy(w) < itemsEnd);
  const pageTotals = page.words.filter((w) => inStrip(w) && cy(w) >= itemsEnd);
  const zoomItems = zoom.words.filter((w) => cy(w) < itemsEnd);
  const zoomTotals = zoom.words.filter((w) => cy(w) >= itemsEnd);
  const candidates: OcrPage[] = [
    page,
    { ...page, words: [...outside, ...zoomItems, ...zoomTotals] },
    { ...page, words: [...outside, ...zoomItems, ...pageTotals] },
    { ...page, words: [...outside, ...pageItems, ...zoomTotals] },
  ];
  let best = page;
  let bestScore = -Infinity;
  for (const c of candidates) {
    const score = readScore(parseBill([c], options));
    if (score > bestScore + 1e-9) {
      best = c;
      bestScore = score;
    }
  }
  return best;
}
