"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  X,
  Upload,
  Camera,
  FileText,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  Building2,
  Calendar,
  Hash,
  Plus,
  Trash2,
  Layers,
  Sparkles,
} from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import {
  computeFileHash,
  checkDuplicateBill,
  uploadMultiPageBill,
  BillRecord,
} from "@/lib/services/bill-service";

interface BillUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  onBillUploaded: (bill: BillRecord) => void;
}

interface PageItem {
  id: string;
  file: File;
  previewUrl: string | null;
  hash: string | null;
}

export function BillUploadModal({
  isOpen,
  onClose,
  onBillUploaded,
}: BillUploadModalProps) {
  const { lang } = useLanguage();
  const isHindi = lang === "hi";

  // Multi-page attachments state
  const [pages, setPages] = useState<PageItem[]>([]);
  const [isHashing, setIsHashing] = useState(false);

  // Optional metadata (AI will read from bill header, but owner can provide/edit)
  const [supplierName, setSupplierName] = useState("");
  const [supplierGstin, setSupplierGstin] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(
    new Date().toISOString().split("T")[0]
  );
  const [irn, setIrn] = useState("");
  const [totalAmount, setTotalAmount] = useState<string>("");

  // Duplicate checks state
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [duplicateMessage, setDuplicateMessage] = useState<string | null>(null);
  const [isCheckingDup, setIsCheckingDup] = useState(false);

  // Submission state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Reset state on open/close
  useEffect(() => {
    if (!isOpen) {
      pages.forEach((p) => {
        if (p.previewUrl && p.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(p.previewUrl);
        }
      });
      setPages([]);
      setSupplierName("");
      setSupplierGstin("");
      setInvoiceNumber("");
      setIrn("");
      setTotalAmount("");
      setIsDuplicate(false);
      setDuplicateMessage(null);
      setErrorMsg(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // Add a newly captured photo or selected file
  const handleAddFiles = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;

    setErrorMsg(null);
    setIsHashing(true);

    const newPageItems: PageItem[] = [];

    try {
      for (let i = 0; i < fileList.length; i++) {
        const file = fileList[i];
        let preview: string | null = null;
        if (file.type.startsWith("image/")) {
          preview = URL.createObjectURL(file);
        }

        const hash = await computeFileHash(file);
        newPageItems.push({
          id: `${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          file,
          previewUrl: preview,
          hash,
        });
      }

      const updatedPages = [...pages, ...newPageItems];
      setPages(updatedPages);

      // Run 3-Tier Duplicate Check
      await runDuplicateCheck(updatedPages, irn, supplierGstin, invoiceNumber);
    } catch (err: any) {
      console.error("Hashing failed:", err);
    } finally {
      setIsHashing(false);
    }
  };

  // Remove a page from the list
  const handleRemovePage = (id: string) => {
    setPages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target?.previewUrl && target.previewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(target.previewUrl);
      }
      const filtered = prev.filter((p) => p.id !== id);
      runDuplicateCheck(filtered, irn, supplierGstin, invoiceNumber);
      return filtered;
    });
  };

  // 3-Tier duplicate check runner
  const runDuplicateCheck = async (
    currentPages: PageItem[],
    currentIrn?: string,
    currentGstin?: string,
    currentInv?: string
  ) => {
    const hashes = currentPages.map((p) => p.hash).filter(Boolean) as string[];
    if (hashes.length === 0 && !currentIrn && (!currentGstin || !currentInv)) {
      setIsDuplicate(false);
      setDuplicateMessage(null);
      return;
    }

    setIsCheckingDup(true);
    try {
      const dup = await checkDuplicateBill({
        fileHashes: hashes,
        irn: currentIrn?.trim() || undefined,
        supplierGstin: currentGstin?.trim() || undefined,
        invoiceNumber: currentInv?.trim() || undefined,
      });

      if (dup.isDuplicate) {
        setIsDuplicate(true);
        setDuplicateMessage(dup.message || "Duplicate bill detected");
      } else {
        setIsDuplicate(false);
        setDuplicateMessage(null);
      }
    } finally {
      setIsCheckingDup(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (pages.length === 0) {
      setErrorMsg(
        isHindi
          ? "कृपया कम से कम एक पेज या फोटो जोड़ें।"
          : "Please capture or add at least one page photo."
      );
      return;
    }

    if (isDuplicate) {
      setErrorMsg(
        isHindi
          ? "यह बिल पहले से मौजूद है। डुप्लीकेट अपलोड ब्लॉक किया गया है।"
          : "This bill already exists. Duplicate uploads are blocked."
      );
      return;
    }

    setIsSubmitting(true);
    setErrorMsg(null);

    try {
      const filesToUpload = pages.map((p) => p.file);
      const result = await uploadMultiPageBill({
        files: filesToUpload,
        supplierName: supplierName.trim() || undefined,
        supplierGstin: supplierGstin.trim() || undefined,
        invoiceNumber: invoiceNumber.trim() || undefined,
        invoiceDate,
        irn: irn.trim() || undefined,
        totalAmount: totalAmount ? parseFloat(totalAmount) : undefined,
      });

      if (!result.success || !result.bill) {
        setErrorMsg(result.error || "Failed to upload bill");
        return;
      }

      onBillUploaded(result.bill);
      onClose();
    } catch (err: any) {
      setErrorMsg(err?.message || "An unexpected error occurred during upload");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-xs animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 bg-linear-to-r from-emerald-50 via-teal-50 to-white">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-600 text-white flex items-center justify-center shadow-xs">
              <Upload className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-black text-slate-900">
                {isHindi ? "पर्ची / बिल अपलोड करें" : "Upload Purchase Bill"}
              </h2>
              <p className="text-xs text-slate-500 font-medium">
                {isHindi
                  ? "डिस्ट्रिब्यूटर पर्ची (1 या अधिक पेज / फोटो)"
                  : "Distributor invoice (1 or more pages / photos)"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="w-8 h-8 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-500 hover:text-slate-800 flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-4">
          {/* Error Alert */}
          {errorMsg && (
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          )}

          {/* Duplicate Alert */}
          {isDuplicate && duplicateMessage && (
            <div className="p-3.5 rounded-2xl bg-amber-50 border border-amber-300 text-amber-900 text-xs font-semibold flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 text-amber-600 mt-0.5" />
              <div>
                <p className="font-bold">
                  {isHindi ? "डुप्लीकेट बिल मिला!" : "Duplicate Bill Detected!"}
                </p>
                <p className="mt-0.5 text-amber-800 text-[11px]">{duplicateMessage}</p>
              </div>
            </div>
          )}

          {/* 1. Multi-Page Attachments Reel */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-slate-400" />
                <span>
                  {isHindi ? "1. पर्ची के पेज (Photos / PDF)" : "1. Bill Pages (Photos / PDF)"}
                </span>
                <span className="text-red-500">*</span>
              </label>
              {pages.length > 0 && (
                <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                  {pages.length} {isHindi ? "पेज जोड़े गए" : "pages attached"}
                </span>
              )}
            </div>

            {/* Hidden native inputs */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/jpeg,image/jpg,image/png,application/pdf"
              className="hidden"
              onChange={(e) => handleAddFiles(e.target.files)}
            />
            <input
              ref={cameraInputRef}
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => handleAddFiles(e.target.files)}
            />

            {/* Attached pages list / preview */}
            {pages.length > 0 && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 mb-3">
                {pages.map((p, idx) => (
                  <div
                    key={p.id}
                    className="relative rounded-2xl border border-slate-200 p-2 bg-slate-50 flex flex-col items-center justify-center group overflow-hidden"
                  >
                    {p.previewUrl ? (
                      <img
                        src={p.previewUrl}
                        alt={`Page ${idx + 1}`}
                        className="w-full h-24 object-cover rounded-xl"
                      />
                    ) : (
                      <div className="w-full h-24 rounded-xl bg-red-100 text-red-600 flex flex-col items-center justify-center">
                        <FileText className="w-8 h-8" />
                        <span className="text-[10px] font-bold mt-1">PDF Document</span>
                      </div>
                    )}
                    <span className="absolute bottom-2 left-2 px-1.5 py-0.5 rounded bg-slate-900/80 text-white font-mono text-[10px] font-bold">
                      Page {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => handleRemovePage(p.id)}
                      className="absolute top-2 right-2 w-6 h-6 rounded-full bg-red-600 text-white flex items-center justify-center opacity-90 hover:opacity-100 transition-opacity cursor-pointer shadow-xs"
                      title={isHindi ? "हटाएं" : "Remove"}
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Buttons to capture or add pages */}
            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="flex items-center justify-center gap-2 p-3.5 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50/50 hover:bg-emerald-50 text-emerald-800 transition-all active:scale-98 cursor-pointer"
              >
                <Camera className="w-4 h-4 text-emerald-600" />
                <span className="text-xs font-bold">
                  {pages.length === 0
                    ? isHindi
                      ? "कैमरा से फोटो खींचें"
                      : "Camera Photo"
                    : isHindi
                    ? "+ अगला पेज खींचें"
                    : "+ Capture Next Page"}
                </span>
              </button>

              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center justify-center gap-2 p-3.5 rounded-2xl border-2 border-dashed border-slate-300 bg-slate-50 hover:bg-slate-100 text-slate-700 transition-all active:scale-98 cursor-pointer"
              >
                <FileText className="w-4 h-4 text-slate-600" />
                <span className="text-xs font-bold">
                  {isHindi ? "फाइल / PDF चुनें" : "Choose Files / PDF"}
                </span>
              </button>
            </div>

            {isHashing && (
              <p className="mt-2 text-[11px] text-slate-500 flex items-center gap-1.5">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-600" />
                <span>{isHindi ? "फाइल की जांच हो रही है..." : "Verifying page integrity..."}</span>
              </p>
            )}
          </div>

          {/* AI Helper Banner */}
          <div className="p-3 rounded-2xl bg-indigo-50/80 border border-indigo-200/80 text-[11px] text-indigo-900 flex items-start gap-2">
            <Sparkles className="w-4 h-4 shrink-0 text-indigo-600 mt-0.5" />
            <div>
              <span className="font-bold">
                {isHindi ? "सप्लायर और इनवॉइस अपने आप पढ़ा जाएगा:" : "Automatic Supplier Detection:"}
              </span>{" "}
              {isHindi
                ? "सप्लायर का नाम (जैसे Jindal Electronics) और GSTIN बिल पढ़ते समय AI खुद निकाल लेगा। आप चाहें तो नीचे भर सकते हैं।"
                : "Distributor name and GSTIN are automatically extracted by AI from the invoice header. You may also enter them manually below."}
            </div>
          </div>

          {/* 2. Optional Distributor / Supplier Name & GSTIN */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Building2 className="w-3.5 h-3.5 text-slate-400" />
                  <span>{isHindi ? "2. डिस्ट्रिब्यूटर / सप्लायर" : "2. Distributor / Supplier"}</span>
                </span>
              </label>
              <input
                type="text"
                value={supplierName}
                onChange={(e) => {
                  setSupplierName(e.target.value);
                  runDuplicateCheck(pages, irn, supplierGstin, invoiceNumber);
                }}
                placeholder={isHindi ? "जैसे Jindal Electronics (वैकल्पिक)" : "e.g. Jindal Electronics (optional)"}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-slate-400" />
                  <span>{isHindi ? "3. सप्लायर GSTIN" : "3. Supplier GSTIN"}</span>
                </span>
              </label>
              <input
                type="text"
                maxLength={15}
                value={supplierGstin}
                onChange={(e) => {
                  setSupplierGstin(e.target.value);
                  runDuplicateCheck(pages, irn, e.target.value, invoiceNumber);
                }}
                placeholder="15-digit GSTIN (optional)"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium font-mono text-slate-900 placeholder-slate-400 uppercase focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* 3. Invoice Number & Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Hash className="w-3.5 h-3.5 text-slate-400" />
                  <span>{isHindi ? "4. इनवॉइस नंबर" : "4. Invoice Number"}</span>
                </span>
              </label>
              <input
                type="text"
                value={invoiceNumber}
                onChange={(e) => {
                  setInvoiceNumber(e.target.value);
                  runDuplicateCheck(pages, irn, supplierGstin, e.target.value);
                }}
                placeholder="e.g. 26-27/6866"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                <span className="flex items-center gap-1.5">
                  <Calendar className="w-3.5 h-3.5 text-slate-400" />
                  <span>{isHindi ? "5. बिल दिनांक" : "5. Invoice Date"}</span>
                </span>
              </label>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-medium text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* 4. E-Invoice IRN (Optional Priority 1 Dup Check) */}
          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
              <span>{isHindi ? "6. ई-इनवॉइस IRN (वैकल्पिक)" : "6. E-Invoice IRN (Optional)"}</span>
            </label>
            <input
              type="text"
              value={irn}
              onChange={(e) => {
                setIrn(e.target.value);
                runDuplicateCheck(pages, e.target.value, supplierGstin, invoiceNumber);
              }}
              placeholder="64-character E-Invoice IRN"
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs font-mono text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Submit Button */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSubmitting || pages.length === 0 || isDuplicate || isCheckingDup}
              className={`w-full py-3.5 rounded-2xl font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer ${
                isSubmitting || pages.length === 0 || isDuplicate || isCheckingDup
                  ? "bg-slate-200 text-slate-400 cursor-not-allowed"
                  : "bg-emerald-600 hover:bg-emerald-700 text-white active:scale-98 shadow-emerald-600/20"
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{isHindi ? "सुरक्षित अपलोड हो रहा है..." : "Uploading to private storage..."}</span>
                </>
              ) : isCheckingDup ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{isHindi ? "डुप्लीकेट जांच हो रही है..." : "Checking duplicates..."}</span>
                </>
              ) : (
                <>
                  <Upload className="w-4 h-4" />
                  <span>
                    {isHindi
                      ? `बिल सुरक्षित अपलोड करें (${pages.length} पेज)`
                      : `Upload & Save Bill (${pages.length} ${pages.length === 1 ? "page" : "pages"})`}
                  </span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
