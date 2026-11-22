/**
 * Small, dependency-free image operations on greyscale pixels.
 *
 * The browser (canvas pixels) and Node (sharp raw pixels) both go through these
 * same functions, so `npm run bills:read` measures exactly what the app does.
 */

export interface GrayImage {
  /** One byte per pixel, row by row. */
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export type QuarterTurn = 0 | 90 | 180 | 270;

/** RGB(A) or grey pixels → grey. Transparent pixels count as white paper. */
export function toGray(pixels: ArrayLike<number>, width: number, height: number, channels: number): GrayImage {
  const data = new Uint8ClampedArray(width * height);
  for (let i = 0, p = 0; i < data.length; i++, p += channels) {
    let v = channels >= 3 ? (pixels[p] * 299 + pixels[p + 1] * 587 + pixels[p + 2] * 114) / 1000 : pixels[p];
    if (channels === 4 || channels === 2) {
      const a = pixels[p + channels - 1] / 255;
      v = v * a + 255 * (1 - a);
    }
    data[i] = v;
  }
  return { data, width, height };
}

/** Grey → RGBA (for putting back on a canvas). */
export function toRgba(img: GrayImage): Uint8ClampedArray {
  const out = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0, p = 0; i < img.data.length; i++, p += 4) {
    out[p] = out[p + 1] = out[p + 2] = img.data[i];
    out[p + 3] = 255;
  }
  return out;
}

/** Turn the image clockwise by a quarter turn multiple. */
export function rotate(img: GrayImage, degrees: QuarterTurn): GrayImage {
  if (degrees === 0) return img;
  const { width: w, height: h, data: src } = img;
  const turned = degrees === 180 ? { w, h } : { w: h, h: w };
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let dx: number, dy: number;
      if (degrees === 90) [dx, dy] = [h - 1 - y, x];
      else if (degrees === 180) [dx, dy] = [w - 1 - x, h - 1 - y];
      else [dx, dy] = [y, w - 1 - x];
      out[dy * turned.w + dx] = src[y * w + x];
    }
  }
  return { data: out, width: turned.w, height: turned.h };
}

/** Catmull-Rom cubic: sharp enough for enlarging text. */
function cubic(t: number): number {
  t = Math.abs(t);
  if (t < 1) return 1.5 * t * t * t - 2.5 * t * t + 1;
  if (t < 2) return -0.5 * t * t * t + 2.5 * t * t - 4 * t + 2;
  return 0;
}

interface Taps {
  start: Int32Array;
  count: Int32Array;
  weights: Float32Array;
  stride: number;
}

/** Which source pixels (and how much of each) make up every output pixel along one axis. */
function taps(srcLen: number, dstLen: number): Taps {
  const scale = dstLen / srcLen;
  const up = scale >= 1;
  // Enlarging: cubic over 4 pixels. Shrinking: a triangle widened to cover every source pixel (no aliasing).
  const support = up ? 2 : 1 / scale;
  const kernel = up ? cubic : (t: number) => Math.max(0, 1 - Math.abs(t) * scale);
  const stride = Math.ceil(support) * 2 + 1;
  const start = new Int32Array(dstLen);
  const count = new Int32Array(dstLen);
  const weights = new Float32Array(dstLen * stride);
  for (let d = 0; d < dstLen; d++) {
    const center = (d + 0.5) / scale - 0.5;
    const lo = Math.ceil(center - support);
    const hi = Math.floor(center + support);
    let sum = 0;
    let n = 0;
    for (let s = lo; s <= hi && n < stride; s++, n++) {
      const wgt = kernel(s - center);
      weights[d * stride + n] = wgt;
      sum += wgt;
    }
    for (let k = 0; k < n; k++) weights[d * stride + k] /= sum || 1;
    start[d] = lo;
    count[d] = n;
  }
  return { start, count, weights, stride };
}

/** Resize by a factor (enlarge with cubic, shrink with area-averaging). */
export function resize(img: GrayImage, scale: number): GrayImage {
  const dw = Math.max(1, Math.round(img.width * scale));
  const dh = Math.max(1, Math.round(img.height * scale));
  if (dw === img.width && dh === img.height) return img;
  const { width: sw, height: sh, data: src } = img;

  // Horizontal pass → float buffer (dw × sh)
  const tx = taps(sw, dw);
  const mid = new Float32Array(dw * sh);
  for (let y = 0; y < sh; y++) {
    const row = y * sw;
    for (let x = 0; x < dw; x++) {
      let acc = 0;
      const base = x * tx.stride;
      for (let k = 0; k < tx.count[x]; k++) {
        const sx = Math.min(sw - 1, Math.max(0, tx.start[x] + k));
        acc += src[row + sx] * tx.weights[base + k];
      }
      mid[y * dw + x] = acc;
    }
  }
  // Vertical pass → bytes (dw × dh)
  const ty = taps(sh, dh);
  const out = new Uint8ClampedArray(dw * dh);
  for (let y = 0; y < dh; y++) {
    const base = y * ty.stride;
    for (let x = 0; x < dw; x++) {
      let acc = 0;
      for (let k = 0; k < ty.count[y]; k++) {
        const sy = Math.min(sh - 1, Math.max(0, ty.start[y] + k));
        acc += mid[sy * dw + x] * ty.weights[base + k];
      }
      out[y * dw + x] = acc; // Uint8ClampedArray rounds and clamps
    }
  }
  return { data: out, width: dw, height: dh };
}
