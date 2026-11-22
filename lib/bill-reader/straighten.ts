/**
 * Straighten a tilted or curved page using the words themselves.
 *
 * In phone photos the page is rarely flat: it is tilted, curls towards the edges,
 * or is shot at an angle. Then the amount at the right end of an item row sits a
 * whole line higher or lower than the item's description, and rows get mixed up.
 *
 * We look for the smooth vertical shift f(x, y) that makes the words line up in
 * the tightest rows (a "projection profile" search), and subtract it from every
 * word's y. x is left alone. The shift model covers tilt (a·u), curl (b·u²) and
 * perspective (c·u·v), with u, v = position relative to the page centre.
 */
import { OcrWord } from "./types";

export interface Warp {
  a: number;
  b: number;
  c: number;
  xc: number;
  yc: number;
  w: number;
}

const IDENTITY = (xc: number, yc: number, w: number): Warp => ({ a: 0, b: 0, c: 0, xc, yc, w });

export function warpShift(m: Warp, x: number, y: number): number {
  const u = (x - m.xc) / m.w;
  const v = (y - m.yc) / m.w;
  return (m.a * u + m.b * u * u + m.c * u * v) * m.w;
}

interface Pt {
  x: number;
  y: number;
  wt: number;
}

/** How tightly the points fall into rows after removing the shift (higher = straighter). */
function sharpness(pts: Pt[], m: Warp, bin: number, hist: Float64Array, offset: number): number {
  hist.fill(0);
  for (const p of pts) {
    const t = (p.y - warpShift(m, p.x, p.y)) / bin + offset;
    const i = Math.floor(t);
    if (i < 0 || i + 1 >= hist.length) continue;
    const f = t - i; // split between the two nearest bins (smooth score)
    hist[i] += p.wt * (1 - f);
    hist[i + 1] += p.wt * f;
  }
  let s = 0;
  for (let i = 0; i < hist.length; i++) s += hist[i] * hist[i];
  return s;
}

export function estimateWarp(words: OcrWord[], lineHeight: number): Warp {
  const xs = words.map((w) => (w.x0 + w.x1) / 2);
  const ys = words.map((w) => (w.y0 + w.y1) / 2);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xc = (minX + maxX) / 2;
  const yc = (minY + maxY) / 2;
  const w = Math.max(1, maxX - minX);
  if (words.length < 12) return IDENTITY(xc, yc, w);

  const pts: Pt[] = words
    .filter((wd) => {
      const h = wd.y1 - wd.y0;
      return h > lineHeight * 0.5 && h < lineHeight * 2;
    })
    .map((wd) => ({ x: (wd.x0 + wd.x1) / 2, y: (wd.y0 + wd.y1) / 2, wt: Math.min(4, Math.max(0.5, (wd.x1 - wd.x0) / lineHeight)) }));

  const bin = lineHeight / 2;
  const span = maxY - minY + 2 * w * 0.2; // room for the largest shifts tried
  const offset = (w * 0.1) / bin + 2 - minY / bin;
  const hist = new Float64Array(Math.ceil(span / bin) + 8);

  const score = (m: Warp) => sharpness(pts, m, bin, hist, offset);
  let best = IDENTITY(xc, yc, w);
  let bestScore = score(best);
  const identityScore = bestScore;

  const search = (aR: number[], bR: number[], cR: number[]) => {
    for (const a of aR)
      for (const b of bR)
        for (const c of cR) {
          const m = { a, b, c, xc, yc, w };
          const s = score(m);
          if (s > bestScore) {
            bestScore = s;
            best = m;
          }
        }
  };
  const range = (center: number, half: number, step: number) => {
    const out: number[] = [];
    for (let v = center - half; v <= center + half + 1e-9; v += step) out.push(v);
    return out;
  };

  // Coarse: tilt first (most common), then curl / perspective around it, then refine.
  search(range(0, 0.12, 0.004), [0], [0]);
  search(range(best.a, 0.02, 0.004), range(0, 0.12, 0.02), range(0, 0.12, 0.02));
  search(range(best.a, 0.006, 0.001), range(best.b, 0.02, 0.005), range(best.c, 0.02, 0.005));

  // Only trust a clear improvement (clean scans / PDFs stay untouched).
  return bestScore > identityScore * 1.03 ? best : IDENTITY(xc, yc, w);
}

/** Words with y corrected by the page warp. */
export function straighten(words: OcrWord[], lineHeight: number): { words: OcrWord[]; warp: Warp } {
  const warp = estimateWarp(words, lineHeight);
  if (warp.a === 0 && warp.b === 0 && warp.c === 0) return { words, warp };
  return {
    warp,
    words: words.map((w) => {
      const d = warpShift(warp, (w.x0 + w.x1) / 2, (w.y0 + w.y1) / 2);
      return { ...w, y0: w.y0 - d, y1: w.y1 - d };
    }),
  };
}
