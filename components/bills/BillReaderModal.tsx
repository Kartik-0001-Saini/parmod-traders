"use client";

/**
 * Reads an uploaded bill in the browser and shows each step live:
 *   1. Reading the image  2. Extracting the text  3. Understanding the bill  4. Saving to database
 * If a step fails, only that step turns red, with the reason and "Try again"
 * (which continues from that step — earlier work is kept).
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  X,
  ImageIcon,
  ScanText,
  Calculator,
  Database,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RotateCcw,
  ClipboardCheck,
  Info,
} from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import type { BillRecord } from "@/lib/services/bill-service";
import type { OcrPage, ParsedBill, ParseOptions } from "@/lib/bill-reader";
import type { PreparedPage } from "@/lib/bill-reader/read-bill";
import type { BrowserEngine } from "@/lib/bill-reader/browser";
import type { PageReadInfo } from "@/lib/bill-reader/pipeline";
import { SHOP_GSTIN } from "@/lib/shop-config";
import { downloadBillFiles, fetchKnownSuppliers, saveBillReading } from "@/lib/services/bill-reading-service";

type StepKey = "image" | "text" | "understand" | "save";
type StepStatus = "waiting" | "running" | "done" | "failed";

interface StepState {
  status: StepStatus;
  detail: string;
  progress: number | null;
  error: string | null;
}

const ORDER: StepKey[] = ["image", "text", "understand", "save"];

const LABELS: Record<StepKey, { en: string; hi: string; icon: React.ElementType; hint: { en: string; hi: string } }> = {
  image: {
    en: "Reading the image",
    hi: "फोटो पढ़ी जा रही है",
    icon: ImageIcon,
    hint: { en: "Which way up, how big the text is", hi: "पेज सीधा है या नहीं, अक्षर कितने बड़े हैं" },
  },
  text: {
    en: "Extracting the text",
    hi: "लिखावट निकाली जा रही है",
    icon: ScanText,
    hint: { en: "Reading every word and number", hi: "हर शब्द और अंक पढ़ा जा रहा है" },
  },
  understand: {
    en: "Understanding the bill",
    hi: "बिल समझा जा रहा है",
    icon: Calculator,
    hint: { en: "Matching columns, checking qty × rate = amount and the totals", hi: "कॉलम मिलाना, मात्रा × रेट = राशि और टोटल जांचना" },
  },
  save: {
    en: "Saving to database",
    hi: "डेटाबेस में सेव हो रहा है",
    icon: Database,
    hint: { en: "Items saved for your review", hi: "आइटम आपकी जांच के लिए सेव" },
  },
};

const fresh = (): Record<StepKey, StepState> => ({
  image: { status: "waiting", detail: "", progress: null, error: null },
  text: { status: "waiting", detail: "", progress: null, error: null },
  understand: { status: "waiting", detail: "", progress: null, error: null },
  save: { status: "waiting", detail: "", progress: null, error: null },
});

interface BillReaderModalProps {
  bill: BillRecord;
  /** The files just uploaded (saves downloading them again). */
  files?: { blob: Blob; name: string }[];
  onClose: () => void;
  /** The reading was saved (bill status is now "extracted"). */
  onSaved: (billId: string) => void;
  onReview: (bill: BillRecord) => void;
}

function describePages(info: (PageReadInfo | null)[], hi: boolean): string {
  return info
    .map((p, i) => {
      const page = info.length > 1 ? (hi ? `पेज ${i + 1}: ` : `Page ${i + 1}: `) : "";
      if (!p) return page + (hi ? "डिजिटल PDF (सटीक लिखावट)" : "digital PDF (exact text)");
      const parts: string[] = [];
      if (p.rotation === 180) parts.push(hi ? "उल्टा था — सीधा किया" : "was upside down — turned");
      else if (p.rotation) parts.push(hi ? `तिरछा था — ${p.rotation}° घुमाया` : `was sideways — turned ${p.rotation}°`);
      if (p.scale > 1.15) parts.push(hi ? `छोटे अक्षर — ${p.scale.toFixed(1)}× बड़ा किया` : `small text — enlarged ${p.scale.toFixed(1)}×`);
      if (parts.length === 0) parts.push(hi ? "ठीक है" : "looks fine");
      return page + parts.join(", ");
    })
    .join(" · ");
}

export function BillReaderModal({ bill, files, onClose, onSaved, onReview }: BillReaderModalProps) {
  const { lang } = useLanguage();
  const hi = lang === "hi";
  const [steps, setSteps] = useState<Record<StepKey, StepState>>(fresh);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<ParsedBill | null>(null);

  // Work kept between steps, so "Try again" continues where it failed.
  const engineRef = useRef<BrowserEngine | null>(null);
  const preparedRef = useRef<PreparedPage[] | null>(null);
  const infoRef = useRef<(PageReadInfo | null)[]>([]);
  const pagesRef = useRef<OcrPage[] | null>(null);
  const parsedRef = useRef<ParsedBill | null>(null);
  const optionsRef = useRef<ParseOptions | null>(null);
  // Each run gets an id; closing the screen (or a newer run) makes older runs stop quietly.
  const runId = useRef(0);

  const set = useCallback((key: StepKey, patch: Partial<StepState>) => {
    setSteps((s) => ({ ...s, [key]: { ...s[key], ...patch } }));
  }, []);

  const run = useCallback(
    async (from: StepKey) => {
      const id = ++runId.current;
      const stale = () => id !== runId.current;
      setRunning(true);
      // Reset this step and the ones after it.
      setSteps((s) => {
        const next = { ...s };
        for (const k of ORDER.slice(ORDER.indexOf(from))) next[k] = { status: "waiting", detail: "", progress: null, error: null };
        return next;
      });

      let current: StepKey = from;
      try {
        const reader = await import("@/lib/bill-reader/read-bill");
        const browser = await import("@/lib/bill-reader/browser");
        optionsRef.current ??= { ownGstin: SHOP_GSTIN, knownSuppliers: await fetchKnownSuppliers() };
        const options = optionsRef.current;

        // 1. Reading the image
        if (ORDER.indexOf(from) <= 0) {
          current = "image";
          set("image", { status: "running", detail: hi ? "बिल के पेज लिए जा रहे हैं…" : "Getting the bill pages…" });
          const input = files?.length ? files : await downloadBillFiles(bill);
          if (!engineRef.current) {
            set("image", { detail: hi ? "रीडर लोड हो रहा है (पहली बार ~10 MB)…" : "Loading the reader (first time ~10 MB)…" });
            const engine = await browser.createBrowserEngine();
            if (stale()) {
              await engine.terminate();
              return;
            }
            engineRef.current = engine;
          }
          const sources = [];
          for (const f of input) sources.push(...(await browser.fileToSources(f.blob, f.name)));
          if (sources.length === 0) throw new Error(hi ? "बिल में कोई पेज नहीं मिला।" : "No pages found in the bill.");
          preparedRef.current = await reader.prepareAll(sources, engineRef.current.engine, {
            onPage: (i, n) => n > 1 && set("image", { detail: hi ? `पेज ${i + 1} / ${n}` : `Page ${i + 1} of ${n}` }),
            onStatus: (m) => set("image", { detail: m }),
            onProgress: (f) => set("image", { progress: f }),
          });
          infoRef.current = preparedRef.current.map((p) => (p.kind === "image" ? p.prepared.info : null));
          if (stale()) return;
          set("image", { status: "done", progress: 1, detail: describePages(infoRef.current, hi) });
        }

        // 2. Extracting the text
        if (ORDER.indexOf(from) <= 1) {
          current = "text";
          if (!preparedRef.current || !engineRef.current) throw new Error("Start again from step 1.");
          set("text", { status: "running", detail: hi ? "पढ़ा जा रहा है…" : "Reading…", progress: 0 });
          const extracted = await reader.extractAll(preparedRef.current, engineRef.current.engine, options, {
            onPage: (i, n) => n > 1 && set("text", { detail: hi ? `पेज ${i + 1} / ${n}` : `Page ${i + 1} of ${n}` }),
            onStatus: (m) => set("text", { detail: m === "Zooming in on the item table" && hi ? "आइटम टेबल ज़ूम करके दोबारा पढ़ी जा रही है" : m }),
            onProgress: (f) => set("text", { progress: f }),
          });
          pagesRef.current = extracted.pages;
          const words = extracted.pages.reduce((n, p) => n + p.words.length, 0);
          if (words < 20) {
            throw new Error(
              hi
                ? "फोटो में लगभग कुछ भी पढ़ा नहीं जा सका। बिल को समतल रखकर, पास से और रोशनी में दोबारा फोटो लें।"
                : "Almost nothing could be read. Retake the photo with the bill flat, close up and in good light."
            );
          }
          if (stale()) return;
          set("text", { status: "done", progress: 1, detail: hi ? `${words} शब्द/अंक पढ़े गए` : `${words} words and numbers read` });
        }

        // 3. Understanding the bill
        if (ORDER.indexOf(from) <= 2) {
          current = "understand";
          if (!pagesRef.current) throw new Error("Start again from step 2.");
          set("understand", { status: "running", detail: "" });
          const parsed = reader.understand(pagesRef.current, options);
          parsedRef.current = parsed;
          if (parsed.lines.length === 0) {
            throw new Error(
              hi
                ? "बिल में आइटम की लाइनें नहीं मिलीं। पूरी आइटम टेबल दिखे ऐसी सीधी फोटो लें, या PDF मंगवाएं।"
                : "No item lines found. Take a straight photo that shows the whole item table, or ask the supplier for the PDF."
            );
          }
          const flagged = parsed.lines.filter((l) => l.flags.length > 0).length;
          const checksOk = parsed.checks.filter((c) => c.ok).length;
          set("understand", {
            status: "done",
            detail: hi
              ? `${parsed.lines.length} आइटम मिले · ${flagged} जांचने हैं · टोटल ${checksOk}/${parsed.checks.length} मेल खाते हैं`
              : `${parsed.lines.length} items found · ${flagged} to check · ${checksOk} of ${parsed.checks.length} totals agree`,
          });
        }

        // 4. Saving to database
        current = "save";
        if (!parsedRef.current) throw new Error("Start again from step 3.");
        if (stale()) return;
        set("save", { status: "running", detail: "" });
        const saved = await saveBillReading(bill.id, parsedRef.current);
        if (!saved.ok) throw new Error(saved.error);
        set("save", { status: "done", detail: hi ? `${saved.lines} लाइनें सेव हुईं` : `${saved.lines} lines saved` });
        setResult(parsedRef.current);
        onSaved(bill.id);
      } catch (err) {
        if (stale()) return;
        const message = err instanceof Error ? err.message : String(err);
        const friendly = /Failed to fetch|NetworkError|load failed|importScripts/i.test(message)
          ? hi
            ? "इंटरनेट कनेक्शन नहीं मिला (रीडर लोड नहीं हो सका)। कनेक्शन जांचें और दोबारा कोशिश करें।"
            : "No internet connection (the reader could not load). Check the connection and try again."
          : message;
        set(current, { status: "failed", error: friendly, progress: null });
      } finally {
        if (!stale()) setRunning(false);
      }
    },
    [bill, files, hi, onSaved, set]
  );

  // Start as soon as the screen opens; free the OCR engine when it closes.
  useEffect(() => {
    run("image");
    return () => {
      runId.current++;
      engineRef.current?.terminate().catch(() => undefined);
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const failed = ORDER.find((k) => steps[k].status === "failed");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 bg-linear-to-r from-indigo-50 to-white">
          <div className="min-w-0">
            <h2 className="text-base font-black text-slate-900">{hi ? "बिल पढ़ा जा रहा है" : "Reading the bill"}</h2>
            <p className="text-xs text-slate-500 truncate">
              {bill.supplier_name && bill.supplier_name !== "Pending AI Extraction" ? bill.supplier_name : hi ? "नया बिल" : "New bill"}
              {bill.page_count > 1 ? ` · ${bill.page_count} ${hi ? "पेज" : "pages"}` : ""}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 flex items-center justify-center cursor-pointer"
            title={running ? (hi ? "रोकें और बंद करें" : "Stop and close") : hi ? "बंद करें" : "Close"}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <ol className="flex-1 overflow-y-auto p-5 space-y-3">
          {ORDER.map((key, i) => {
            const s = steps[key];
            const L = LABELS[key];
            const Icon = L.icon;
            const tone =
              s.status === "failed"
                ? "border-red-300 bg-red-50"
                : s.status === "done"
                  ? "border-emerald-200 bg-emerald-50/60"
                  : s.status === "running"
                    ? "border-indigo-300 bg-indigo-50/60"
                    : "border-slate-200 bg-white opacity-60";
            return (
              <li key={key} className={`rounded-2xl border p-3.5 transition-colors ${tone}`}>
                <div className="flex items-start gap-3">
                  <div className="w-9 h-9 rounded-xl bg-white border border-slate-200 flex items-center justify-center shrink-0">
                    {s.status === "running" ? (
                      <Loader2 className="w-4 h-4 animate-spin text-indigo-600" />
                    ) : s.status === "done" ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                    ) : s.status === "failed" ? (
                      <AlertTriangle className="w-4 h-4 text-red-600" />
                    ) : (
                      <Icon className="w-4 h-4 text-slate-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-slate-900">
                      {i + 1}. {hi ? L.hi : L.en}
                    </p>
                    <p className="text-[11px] text-slate-500">{s.detail || (hi ? L.hint.hi : L.hint.en)}</p>
                    {s.status === "running" && s.progress !== null && (
                      <div className="mt-2 h-1.5 rounded-full bg-indigo-100 overflow-hidden">
                        <div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.round(s.progress * 100)}%` }} />
                      </div>
                    )}
                    {s.status === "failed" && (
                      <div className="mt-2">
                        <p className="text-xs font-semibold text-red-700">{s.error}</p>
                        <button
                          onClick={() => run(key)}
                          disabled={running}
                          className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-red-600 hover:bg-red-700 text-white text-xs font-bold cursor-pointer disabled:opacity-50"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          {hi ? "दोबारा कोशिश करें" : "Try again"}
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </li>
            );
          })}

          {result && (
            <li className="rounded-2xl border border-slate-200 p-3.5 bg-slate-50 space-y-1.5">
              {result.checks.map((c) => (
                <p key={c.name} className={`text-[11px] ${c.ok ? "text-emerald-700" : "text-amber-700"}`}>
                  {c.ok ? "✔" : "✘"} {c.name}: {c.detail}
                </p>
              ))}
              {result.warnings
                .filter((w) => !/heading not found/i.test(w))
                .map((w) => (
                  <p key={w} className="text-[11px] text-slate-600 flex gap-1">
                    <Info className="w-3 h-3 shrink-0 mt-0.5" />
                    <span>{w}</span>
                  </p>
                ))}
            </li>
          )}
        </ol>

        <div className="p-4 border-t border-slate-100 flex gap-2">
          {result ? (
            <button
              onClick={() => onReview(bill)}
              className="flex-1 flex items-center justify-center gap-2 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm cursor-pointer"
            >
              <ClipboardCheck className="w-4 h-4" />
              {hi ? "जांचें और स्टॉक में जोड़ें" : "Review & add to stock"}
            </button>
          ) : (
            <button
              onClick={onClose}
              className="flex-1 py-3 rounded-2xl border border-slate-200 text-slate-700 font-bold text-sm cursor-pointer hover:bg-slate-50"
            >
              {failed ? (hi ? "बंद करें (बिल सेव रहेगा)" : "Close (the bill stays saved)") : hi ? "बंद करें" : "Close"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
