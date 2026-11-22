/**
 * Photo → OCR words, tuned for phone photos of bills:
 *
 *  1. prepareImage(): find which way up the page is (photos arrive sideways or upside
 *     down) and how big the text is, then resize so text is ~24 px tall — the size
 *     Tesseract reads best. WhatsApp photos are 1200×1600, where table text is only
 *     6–11 px tall; enlarging it is what makes the numbers readable.
 *  2. extractText(): read the prepared image.
 *
 * Both steps are platform-neutral: the caller supplies an OcrEngine (Node: sharp →
 * PNG → Tesseract; browser: canvas → Tesseract).
 */
import { GrayImage, QuarterTurn, crop, resize, rotate } from "./image";
import { OcrPage, OcrWord } from "./types";

export type { OcrWord };

export interface OcrEngine {
  recognize(img: GrayImage, onProgress?: (fraction: number) => void): Promise<OcrPage>;
}

export interface PageReadInfo {
  rotation: QuarterTurn;
  /** Factor the photo was enlarged (>1) or reduced (<1) by for the final read. */
  scale: number;
  /** Median text height in the original photo (px), or null if it couldn't be measured. */
  textHeight: number | null;
  /** Readable words found at each orientation tried. */
  orientationScores: Partial<Record<QuarterTurn, number>>;
}

export interface PreparedImage {
  image: GrayImage;
  /** The photo turned the right way up, at its own resolution (for the zoomed table read). */
  turned: GrayImage;
  info: PageReadInfo;
  /** OCR result from the orientation check, reused when it was already at the final size. */
  reusable: OcrPage | null;
}

export interface StepCallbacks {
  /** Short status line for the UI. */
  onStatus?: (message: string) => void;
  /** 0–1 progress of the current step. */
  onProgress?: (fraction: number) => void;
}

/** Orientation check runs on a copy no bigger than this (long side, px). */
const PROBE_LONG_SIDE = 1600;
/** This many confidently read words means "right way up" — no need to try other turns. */
const GOOD_ORIENTATION = 25;
/** Text height Tesseract reads best (px). */
const TARGET_TEXT_HEIGHT = 24;
const MAX_SCALE = 3;
/** Pixel budget for the final image (keeps phones from running out of memory). */
const MAX_PIXELS = 12_000_000;

/** Words Tesseract is confident about and that look like real text (not noise). */
function readableWords(words: OcrWord[]): OcrWord[] {
  return words.filter((w) => w.conf >= 70 && /[A-Za-z]{3,}/.test(w.text));
}

function medianTextHeight(words: OcrWord[]): number | null {
  const good = words.filter((w) => w.conf >= 60 && /[A-Za-z0-9]{2,}/.test(w.text));
  if (good.length < 6) return null;
  const hs = good.map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  return hs[Math.floor(hs.length / 2)];
}

export async function prepareImage(original: GrayImage, engine: OcrEngine, cb: StepCallbacks = {}): Promise<PreparedImage> {
  const long = Math.max(original.width, original.height);
  const probeScale = Math.min(1, PROBE_LONG_SIDE / long);
  const probeBase = resize(original, probeScale);

  const scores: Partial<Record<QuarterTurn, number>> = {};
  const results = new Map<QuarterTurn, OcrPage>();
  const order: QuarterTurn[] = [0, 180, 90, 270];
  let best: QuarterTurn = 0;
  for (let i = 0; i < order.length; i++) {
    const turn = order[i];
    cb.onStatus?.(i === 0 ? "Checking which way up the page is" : `Trying the page turned ${turn}°`);
    const page = await engine.recognize(rotate(probeBase, turn), (f) => cb.onProgress?.((i + f) / order.length));
    results.set(turn, page);
    scores[turn] = readableWords(page.words).length;
    if (scores[turn]! > scores[best]!) best = turn;
    if (scores[turn]! >= GOOD_ORIENTATION) break;
  }

  const probe = results.get(best)!;
  const probeHeight = medianTextHeight(probe.words);
  const textHeight = probeHeight !== null ? probeHeight / probeScale : null;

  const turned = rotate(original, best);
  let scale = textHeight !== null ? TARGET_TEXT_HEIGHT / textHeight : 2;
  scale = Math.min(scale, MAX_SCALE, Math.sqrt(MAX_PIXELS / (turned.width * turned.height)));
  // Don't bother resizing for a few percent.
  if (Math.abs(scale - 1) < 0.1) scale = 1;

  const reuse = Math.abs(scale - probeScale) / scale < 0.12;
  cb.onProgress?.(1);
  return {
    image: reuse ? rotate(probeBase, best) : resize(turned, scale),
    turned,
    info: { rotation: best, scale: reuse ? probeScale : scale, textHeight, orientationScores: scores },
    reusable: reuse ? probe : null,
  };
}

export async function extractText(prepared: PreparedImage, engine: OcrEngine, cb: StepCallbacks = {}): Promise<OcrPage> {
  if (prepared.reusable) {
    cb.onProgress?.(1);
    return prepared.reusable;
  }
  cb.onStatus?.("Reading the text");
  return engine.recognize(prepared.image, cb.onProgress);
}

/** Text height for the zoomed table read (px). Bigger than the page read: table text is the smallest. */
const ZOOM_TEXT_HEIGHT = 36;
const MAX_ZOOM_SCALE = 5;

export interface ZoomedRead {
  /** Words of the zoomed strip, in page coordinates. */
  words: OcrWord[];
  /** The strip's top and bottom, in page coordinates. */
  top: number;
  bottom: number;
}

/**
 * Read the item table again, cut out and enlarged. On phone photos the table text is
 * the smallest on the page; reading just that strip bigger fixes many misread numbers
 * (and sometimes damages others — the caller keeps whichever read checks out better).
 */
export async function zoomTable(
  prepared: PreparedImage,
  page: OcrPage,
  region: { y0: number; y1: number },
  engine: OcrEngine,
  cb: StepCallbacks = {}
): Promise<ZoomedRead | null> {
  const s = prepared.info.scale;
  const inRegion = page.words.filter((w) => (w.y0 + w.y1) / 2 >= region.y0 && (w.y0 + w.y1) / 2 <= region.y1);
  const heights = inRegion.filter((w) => w.conf >= 50 && /[A-Za-z0-9]{2,}/.test(w.text)).map((w) => w.y1 - w.y0).sort((a, b) => a - b);
  if (heights.length < 10) return null;
  const tableText = heights[Math.floor(heights.length / 2)] / s; // in the original photo
  const margin = tableText * 2;
  const y0 = Math.max(0, region.y0 / s - margin);
  const y1 = Math.min(prepared.turned.height, region.y1 / s + margin);
  let zoom = Math.min(MAX_ZOOM_SCALE, ZOOM_TEXT_HEIGHT / tableText);
  zoom = Math.min(zoom, Math.sqrt(MAX_PIXELS / (prepared.turned.width * (y1 - y0))));
  // Only worth it if the table gets noticeably bigger than in the page read.
  if (zoom < s * 1.25) return null;

  cb.onStatus?.("Zooming in on the item table");
  const strip = resize(crop(prepared.turned, 0, y0, prepared.turned.width, y1), zoom);
  const read = await engine.recognize(strip, cb.onProgress);
  const k = s / zoom; // zoomed strip → page coordinates
  const words = read.words.map((w) => ({ ...w, x0: w.x0 * k, x1: w.x1 * k, y0: (w.y0 / zoom + y0) * s, y1: (w.y1 / zoom + y0) * s }));
  return { words, top: y0 * s, bottom: y1 * s };
}
