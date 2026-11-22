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
import { GrayImage, QuarterTurn, resize, rotate } from "./image";
import { OcrPage, OcrWord } from "./types";

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
