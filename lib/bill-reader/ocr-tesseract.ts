/**
 * OCR engine wrapper (Tesseract.js). Works in the browser and in Node.
 *
 * Why Tesseract + "sparse text" mode: on the sample bills it read every item
 * row with word positions; PaddleOCR (the engine behind RapidOCR) read the rows
 * but merged each row into one piece and dropped spaces, losing the columns.
 * Tesseract's default page mode skipped whole tables with grid lines, so
 * SPARSE_TEXT is required.
 */
import Tesseract from "tesseract.js";
import { OcrPage, OcrWord } from "./types";

export interface BillOcrOptions {
  /** Where Tesseract caches the ~5 MB English model (Node). Defaults to the current folder. */
  cachePath?: string;
  /** Where to download the language model from. Defaults to the tesseract.js CDN. */
  langPath?: string;
  /** Where to load the worker script / wasm core from (browser). Defaults to the tesseract.js CDN. */
  workerPath?: string;
  corePath?: string;
}

export interface BillOcr {
  /** `onProgress` receives 0–1 while this image is being read. */
  recognize(
    image: Tesseract.ImageLike,
    size?: { width: number; height: number },
    onProgress?: (fraction: number) => void
  ): Promise<OcrPage>;
  terminate(): Promise<void>;
}

export async function createBillOcr(options: BillOcrOptions = {}): Promise<BillOcr> {
  let progress: ((fraction: number) => void) | undefined;
  const workerOptions: Partial<Tesseract.WorkerOptions> = {
    logger: (m) => {
      if (m.status === "recognizing text") progress?.(m.progress);
    },
  };
  if (options.cachePath) workerOptions.cachePath = options.cachePath;
  if (options.langPath) workerOptions.langPath = options.langPath;
  if (options.workerPath) workerOptions.workerPath = options.workerPath;
  if (options.corePath) workerOptions.corePath = options.corePath;

  const worker = await Tesseract.createWorker("eng", Tesseract.OEM.LSTM_ONLY, workerOptions);
  await worker.setParameters({
    tessedit_pageseg_mode: Tesseract.PSM.SPARSE_TEXT,
    preserve_interword_spaces: "1",
  });

  return {
    async recognize(image, size, onProgress) {
      progress = onProgress;
      try {
        const { data } = await worker.recognize(image, {}, { blocks: true });
        const words: OcrWord[] = [];
        for (const block of data.blocks ?? [])
          for (const para of block.paragraphs)
            for (const line of para.lines)
              for (const w of line.words)
                words.push({ text: w.text, conf: w.confidence, x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1 });
        return {
          words,
          width: size?.width ?? Math.max(0, ...words.map((w) => w.x1)),
          height: size?.height ?? Math.max(0, ...words.map((w) => w.y1)),
          source: "ocr",
        };
      } finally {
        progress = undefined;
      }
    },
    async terminate() {
      await worker.terminate();
    },
  };
}
