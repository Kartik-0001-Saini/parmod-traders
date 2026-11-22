"use client";

import React, { useState, useEffect } from "react";
import {
  ReceiptText,
  Upload,
  RefreshCw,
  FileText,
  ExternalLink,
  Trash2,
  Lock,
  Calendar,
  Building2,
  CheckCircle2,
  Clock,
  AlertCircle,
  Eye,
  X,
  Sparkles,
  Layers,
  ChevronLeft,
  ChevronRight,
  ScanText,
  ClipboardCheck,
} from "lucide-react";
import { BillReaderModal } from "@/components/bills/BillReaderModal";
import { BillReviewModal } from "@/components/bills/BillReviewModal";
import { useLanguage } from "@/lib/language-context";
import { useAuth } from "@/lib/auth-context";
import {
  BillRecord,
  fetchBillsList,
  getBillSignedUrlsForPages,
  deleteBillRecord,
} from "@/lib/services/bill-service";
import { BillUploadModal } from "@/components/BillUploadModal";

interface BillsManagerProps {
  onOpenAuthModal: () => void;
  onOpenPinModal: () => void;
  /** A bill was added to stock: reload products / history. */
  onStockChanged?: () => void;
}

export function BillsManager({
  onOpenAuthModal,
  onOpenPinModal,
  onStockChanged,
}: BillsManagerProps) {
  const { lang } = useLanguage();
  const isHindi = lang === "hi";
  const { user, role, isAuthenticated } = useAuth();
  const isOwner = role === "owner";

  const [bills, setBills] = useState<BillRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Multi-page preview modal state
  const [previewState, setPreviewState] = useState<{
    isOpen: boolean;
    bill: BillRecord | null;
    signedUrls: { page_number: number; url: string }[];
    currentPageIndex: number;
    isLoadingUrl: boolean;
  }>({
    isOpen: false,
    bill: null,
    signedUrls: [],
    currentPageIndex: 0,
    isLoadingUrl: false,
  });

  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Reading a bill (live steps) and reviewing it before it goes into stock.
  const [readerTarget, setReaderTarget] = useState<{ bill: BillRecord; files?: { blob: Blob; name: string }[] } | null>(null);
  const [reviewBill, setReviewBill] = useState<BillRecord | null>(null);

  /** Reload the list and return the fresh copy of one bill. */
  const reloadBills = async (billId?: string): Promise<BillRecord | undefined> => {
    const res = await fetchBillsList();
    if (!res.error) setBills(res.bills);
    return billId ? res.bills.find((b) => b.id === billId) : undefined;
  };

  const loadBills = async () => {
    if (!isAuthenticated || !isOwner) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await fetchBillsList();
      if (res.error) {
        setErrorMessage(res.error);
      } else {
        setBills(res.bills);
      }
    } catch (err: any) {
      setErrorMessage(err?.message || "Failed to load bills");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && isOwner) {
      loadBills();
    }
  }, [isAuthenticated, isOwner]);

  // Handle View Bill with Multi-Page support
  const handleViewBill = async (bill: BillRecord) => {
    setPreviewState({
      isOpen: true,
      bill,
      signedUrls: [],
      currentPageIndex: 0,
      isLoadingUrl: true,
    });

    const pages = bill.pages && bill.pages.length > 0
      ? bill.pages
      : [{ page_number: 1, file_url: bill.file_url, file_hash: bill.file_hash }];

    const res = await getBillSignedUrlsForPages(pages);
    if (res.signedUrls && res.signedUrls.length > 0) {
      setPreviewState((prev) => ({
        ...prev,
        signedUrls: res.signedUrls,
        isLoadingUrl: false,
      }));
    } else {
      setErrorMessage(res.error || "Failed to generate preview URL");
      setPreviewState((prev) => ({
        ...prev,
        isLoadingUrl: false,
      }));
    }
  };

  // Handle Delete Bill
  const handleDeleteBill = async (bill: BillRecord) => {
    const confirmDelete = window.confirm(
      isHindi
        ? `क्या आप वाकई "${bill.supplier_name}" का यह बिल हटाना चाहते हैं?`
        : `Are you sure you want to delete the bill from "${bill.supplier_name}"?`
    );
    if (!confirmDelete) return;

    setDeletingId(bill.id);
    try {
      const pagesToDelete = bill.pages && bill.pages.length > 0 ? bill.pages : bill.file_url;
      const res = await deleteBillRecord(bill.id, pagesToDelete);
      if (!res.success) {
        alert(res.error || "Failed to delete bill");
      } else {
        setBills((prev) => prev.filter((b) => b.id !== bill.id));
      }
    } finally {
      setDeletingId(null);
    }
  };

  const getStatusBadge = (status: BillRecord["status"]) => {
    switch (status) {
      case "uploaded":
        return {
          bg: "bg-blue-50 text-blue-700 border-blue-200",
          icon: Clock,
          label: isHindi ? "पर्ची प्राप्त (Uploaded)" : "Uploaded",
        };
      case "checked":
      case "extracted":
        return {
          bg: "bg-amber-50 text-amber-700 border-amber-200",
          icon: Sparkles,
          label: isHindi ? "पढ़ा गया — जांच बाकी" : "Read · review pending",
        };
      case "confirmed":
      case "verified":
        return {
          bg: "bg-emerald-50 text-emerald-800 border-emerald-200",
          icon: CheckCircle2,
          label: isHindi ? "स्टॉक में जुड़ गया (Confirmed)" : "Confirmed",
        };
      case "rejected":
        return {
          bg: "bg-red-50 text-red-700 border-red-200",
          icon: AlertCircle,
          label: isHindi ? "रद्द (Rejected)" : "Rejected",
        };
      default:
        return {
          bg: "bg-slate-100 text-slate-700 border-slate-200",
          icon: Clock,
          label: status,
        };
    }
  };

  // Security guard for non-owner
  if (!isAuthenticated || !isOwner) {
    return (
      <div className="bg-white rounded-3xl p-8 border border-slate-200 text-center flex flex-col items-center gap-4 shadow-xs max-w-lg mx-auto my-6">
        <div className="w-16 h-16 rounded-3xl bg-amber-50 text-amber-600 flex items-center justify-center border border-amber-200 shadow-2xs">
          <Lock className="w-8 h-8" />
        </div>
        <div>
          <h3 className="text-base font-black text-slate-900">
            {isHindi
              ? "पर्चियां और खरीद मूल्य सुरक्षित हैं"
              : "Purchase Bills & Costs are Protected"}
          </h3>
          <p className="mt-1 text-xs text-slate-500 leading-relaxed">
            {isHindi
              ? "दुकान के सुरक्षा नियमों के अनुसार, केवल दुकान मालिक (Owner) ही सप्लायर बिल देख और अपलोड कर सकते हैं।"
              : "Under showroom security policies, only authenticated Owners can access supplier purchase bills and cost prices."}
          </p>
        </div>

        <button
          onClick={onOpenAuthModal}
          className="flex items-center gap-2 px-5 py-3 rounded-2xl bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold transition-all active:scale-95 shadow-md shadow-slate-900/10 cursor-pointer"
        >
          <Lock className="w-4 h-4" />
          <span>{isHindi ? "मालिक (Owner) लॉगिन करें" : "Owner Login"}</span>
        </button>
      </div>
    );
  }

  const currentPreviewPage = previewState.signedUrls[previewState.currentPageIndex];

  return (
    <div className="flex flex-col gap-4">
      {/* Top Banner with Action Controls */}
      <div className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200/90 shadow-2xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-2xl bg-emerald-700 text-white flex items-center justify-center shadow-xs shrink-0">
            <ReceiptText className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-black text-slate-900">
              {isHindi ? "खरीद पर्चियां (Purchase Bills)" : "Purchase Bills & Invoices"}
            </h2>
            <p className="text-xs text-slate-500 font-medium">
              {isHindi
                ? "सुरक्षित प्राइवेट क्लाउड स्टोरेज • कुल पर्चियां: "
                : "Secure Private Cloud Storage • Total: "}
              <span className="font-bold text-slate-800">{bills.length}</span>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <button
            onClick={loadBills}
            disabled={isLoading}
            className="p-2.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 transition-colors cursor-pointer"
            title={isHindi ? "रिफ्रेश करें" : "Refresh"}
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          </button>

          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-sm transition-all active:scale-95 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>{isHindi ? "+ नई पर्ची अपलोड करें" : "+ Upload Bill"}</span>
          </button>
        </div>
      </div>

      {/* Error Message */}
      {errorMessage && (
        <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-700 text-xs font-semibold flex items-center justify-between">
          <span>{errorMessage}</span>
          <button
            onClick={() => setErrorMessage(null)}
            className="text-red-500 hover:text-red-800 font-bold ml-2 cursor-pointer"
          >
            ✕
          </button>
        </div>
      )}

      {/* Bills List / Grid */}
      {isLoading ? (
        <div className="bg-white rounded-3xl p-12 border border-slate-200 text-center flex flex-col items-center gap-3">
          <RefreshCw className="w-8 h-8 animate-spin text-emerald-600" />
          <p className="text-xs font-semibold text-slate-500">
            {isHindi ? "पर्चियां लोड हो रही हैं..." : "Loading purchase bills..."}
          </p>
        </div>
      ) : bills.length === 0 ? (
        <div className="bg-white rounded-3xl p-10 border border-slate-200 text-center flex flex-col items-center gap-3 shadow-xs">
          <div className="w-14 h-14 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center">
            <ReceiptText className="w-7 h-7" />
          </div>
          <h3 className="font-bold text-slate-800 text-base">
            {isHindi ? "अभी तक कोई पर्ची अपलोड नहीं हुई है" : "No bills uploaded yet"}
          </h3>
          <p className="text-xs text-slate-400 max-w-sm">
            {isHindi
              ? "दुकान में आए डिस्ट्रिब्यूटर माल (जैसे Jindal Electronics) की पर्ची कैमरे से फोटो खींचकर अपलोड करें।"
              : "Upload distributor invoices via phone camera or PDF to safely store them in private cloud storage."}
          </p>
          <button
            onClick={() => setIsUploadModalOpen(true)}
            className="mt-2 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-xs active:scale-95 cursor-pointer"
          >
            <Upload className="w-4 h-4" />
            <span>{isHindi ? "पहली पर्ची अपलोड करें" : "Upload First Bill"}</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
          {bills.map((bill) => {
            const badge = getStatusBadge(bill.status);
            const BadgeIcon = badge.icon;
            const formattedDate = bill.invoice_date
              ? new Date(bill.invoice_date).toLocaleDateString("en-IN", {
                  day: "2-digit",
                  month: "short",
                  year: "numeric",
                })
              : "Date not specified";

            const pageCount = bill.pages?.length || bill.page_count || 1;

            return (
              <div
                key={bill.id}
                className="bg-white rounded-3xl p-4 sm:p-5 border border-slate-200/90 shadow-2xs hover:shadow-xs transition-shadow flex flex-col justify-between gap-3.5"
              >
                {/* Header row: Supplier & Status Badge */}
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                      <Building2 className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-sm font-black text-slate-900 truncate">
                        {bill.supplier_name || "Distributor Invoice"}
                      </h4>
                      <p className="text-[11px] font-mono text-slate-500 truncate">
                        {bill.invoice_number ? `Inv: ${bill.invoice_number}` : "No Invoice No."}
                        {bill.supplier_gstin ? ` • GST: ${bill.supplier_gstin}` : ""}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold border shrink-0 ${badge.bg}`}
                  >
                    <BadgeIcon className="w-3 h-3" />
                    <span>{badge.label}</span>
                  </span>
                </div>

                {/* Multi-Page & Continuation Alert Banner */}
                {bill.has_continuation_warning && (
                  <div className="px-3 py-1.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                    <span>
                      {isHindi
                        ? "पेज अधूरा हो सकता है (Continuation noted)"
                        : "Possible missing page (Continued noted on bill)"}
                    </span>
                  </div>
                )}

                {/* Info row: Date, Pages Count & Total Amount */}
                <div className="flex items-center justify-between text-xs pt-1 border-t border-slate-100 text-slate-600">
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-slate-500">
                      <Calendar className="w-3.5 h-3.5 text-slate-400" />
                      <span>{formattedDate}</span>
                    </span>

                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-100 font-mono text-[10px] font-bold text-slate-600">
                      <Layers className="w-3 h-3 text-slate-400" />
                      <span>{pageCount} {pageCount === 1 ? "page" : "pages"}</span>
                    </span>
                  </div>

                  {bill.total_amount ? (
                    <span className="font-bold text-slate-900 font-mono">
                      ₹{bill.total_amount.toLocaleString("en-IN")}
                    </span>
                  ) : (
                    <span className="text-[11px] text-slate-400 italic">
                      {isHindi ? "राशि दर्ज नहीं" : "Amount unbilled"}
                    </span>
                  )}
                </div>

                {/* Action buttons row */}
                <div className="flex items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-1.5">
                    {/* View Bill Button */}
                    <button
                      onClick={() => handleViewBill(bill)}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>{isHindi ? "देखें" : "View"}</span>
                    </button>

                    {/* Delete button (if not confirmed) */}
                    {bill.status !== "confirmed" && (
                      <button
                        onClick={() => handleDeleteBill(bill)}
                        disabled={deletingId === bill.id}
                        className="p-1.5 rounded-xl hover:bg-red-50 text-slate-400 hover:text-red-600 transition-colors cursor-pointer"
                        title={isHindi ? "हटाएं" : "Delete"}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  {/* Next step for this bill */}
                  {bill.status === "uploaded" || bill.status === "rejected" ? (
                    <button
                      onClick={() => setReaderTarget({ bill })}
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold transition-colors cursor-pointer"
                    >
                      <ScanText className="w-3.5 h-3.5" />
                      <span>{isHindi ? "बिल पढ़ें" : "Read bill"}</span>
                    </button>
                  ) : bill.status === "extracted" || bill.status === "checked" ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setReaderTarget({ bill })}
                        className="px-2.5 py-1.5 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-600 text-[11px] font-bold cursor-pointer"
                        title={isHindi ? "दोबारा पढ़ें" : "Read again"}
                      >
                        <ScanText className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => setReviewBill(bill)}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-colors cursor-pointer"
                      >
                        <ClipboardCheck className="w-3.5 h-3.5" />
                        <span>{isHindi ? "जांचें, स्टॉक जोड़ें" : "Review & add"}</span>
                      </button>
                    </div>
                  ) : (
                    <span className="text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-100 flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      <span>
                        {bill.total_pieces ? `${bill.total_pieces} ${isHindi ? "पीस जुड़े" : "pcs added"}` : isHindi ? "स्टॉक में" : "In stock"}
                      </span>
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Bill Upload Modal — reading starts right after the upload */}
      <BillUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        onBillUploaded={(newBill, files) => {
          setBills((prev) => [newBill, ...prev]);
          setReaderTarget({ bill: newBill, files });
        }}
      />

      {/* Live reading steps */}
      {readerTarget && (
        <BillReaderModal
          key={readerTarget.bill.id}
          bill={readerTarget.bill}
          files={readerTarget.files}
          onClose={() => {
            setReaderTarget(null);
            reloadBills();
          }}
          onSaved={(billId) => {
            reloadBills(billId);
          }}
          onReview={async (b) => {
            const fresh = (await reloadBills(b.id)) ?? b;
            setReaderTarget(null);
            setReviewBill(fresh);
          }}
        />
      )}

      {/* Review and add to stock */}
      {reviewBill && (
        <BillReviewModal
          key={reviewBill.id}
          bill={reviewBill}
          onClose={() => {
            setReviewBill(null);
            reloadBills();
          }}
          onConfirmed={() => {
            setReviewBill(null);
            reloadBills();
            onStockChanged?.();
          }}
        />
      )}

      {/* Multi-Page Private File Lightbox / Preview Modal */}
      {previewState.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-xs animate-in fade-in">
          <div className="relative w-full max-w-3xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-200 bg-slate-50">
              <div className="flex items-center gap-2 min-w-0">
                <FileText className="w-4 h-4 text-emerald-600 shrink-0" />
                <span className="text-xs font-bold text-slate-800 truncate">
                  {previewState.bill?.supplier_name || "Distributor Invoice"} •{" "}
                  {previewState.bill?.invoice_number || "Invoice"}
                </span>
                {previewState.signedUrls.length > 1 && (
                  <span className="text-[11px] font-bold text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded-md font-mono">
                    Page {previewState.currentPageIndex + 1} of {previewState.signedUrls.length}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {currentPreviewPage?.url && (
                  <a
                    href={currentPreviewPage.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-600 text-xs font-semibold flex items-center gap-1"
                    title={isHindi ? "नई विंडो में खोलें" : "Open in new window"}
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
                <button
                  onClick={() =>
                    setPreviewState({
                      isOpen: false,
                      bill: null,
                      signedUrls: [],
                      currentPageIndex: 0,
                      isLoadingUrl: false,
                    })
                  }
                  className="w-7 h-7 rounded-full bg-slate-200 hover:bg-slate-300 text-slate-600 flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Modal Content with Page Switcher */}
            <div className="flex-1 overflow-auto p-4 flex flex-col items-center justify-center bg-slate-100 min-h-[350px] relative">
              {previewState.isLoadingUrl ? (
                <div className="flex flex-col items-center gap-2 text-slate-500 text-xs font-medium">
                  <RefreshCw className="w-6 h-6 animate-spin text-emerald-600" />
                  <span>
                    {isHindi
                      ? "सुरक्षित लिंक बनाया जा रहा है..."
                      : "Generating secure preview..."}
                  </span>
                </div>
              ) : currentPreviewPage?.url ? (
                currentPreviewPage.url.includes(".pdf") ? (
                  <iframe
                    src={currentPreviewPage.url}
                    className="w-full h-[65vh] rounded-xl border border-slate-300"
                    title="PDF Bill Viewer"
                  />
                ) : (
                  <div className="relative flex items-center justify-center w-full">
                    <img
                      src={currentPreviewPage.url}
                      alt={`Bill Page ${previewState.currentPageIndex + 1}`}
                      className="max-h-[68vh] max-w-full rounded-xl object-contain shadow-sm"
                    />

                    {/* Left/Right Page Navigation Arrows */}
                    {previewState.signedUrls.length > 1 && (
                      <>
                        <button
                          type="button"
                          disabled={previewState.currentPageIndex === 0}
                          onClick={() =>
                            setPreviewState((prev) => ({
                              ...prev,
                              currentPageIndex: Math.max(0, prev.currentPageIndex - 1),
                            }))
                          }
                          className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-slate-900/70 hover:bg-slate-900 text-white flex items-center justify-center disabled:opacity-20 cursor-pointer shadow-md transition-opacity"
                        >
                          <ChevronLeft className="w-5 h-5" />
                        </button>

                        <button
                          type="button"
                          disabled={
                            previewState.currentPageIndex ===
                            previewState.signedUrls.length - 1
                          }
                          onClick={() =>
                            setPreviewState((prev) => ({
                              ...prev,
                              currentPageIndex: Math.min(
                                prev.signedUrls.length - 1,
                                prev.currentPageIndex + 1
                              ),
                            }))
                          }
                          className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-slate-900/70 hover:bg-slate-900 text-white flex items-center justify-center disabled:opacity-20 cursor-pointer shadow-md transition-opacity"
                        >
                          <ChevronRight className="w-5 h-5" />
                        </button>
                      </>
                    )}
                  </div>
                )
              ) : (
                <div className="text-center text-xs text-red-500 font-semibold">
                  {isHindi ? "पर्ची लोड नहीं हो सकी।" : "Unable to load bill preview."}
                </div>
              )}
            </div>

            {/* Bottom Page Thumbnails Bar (if multi-page) */}
            {previewState.signedUrls.length > 1 && (
              <div className="flex items-center justify-center gap-2 p-2.5 bg-white border-t border-slate-200">
                {previewState.signedUrls.map((p, idx) => (
                  <button
                    key={p.page_number}
                    onClick={() =>
                      setPreviewState((prev) => ({ ...prev, currentPageIndex: idx }))
                    }
                    className={`px-3 py-1 rounded-xl text-xs font-bold font-mono transition-all cursor-pointer ${
                      previewState.currentPageIndex === idx
                        ? "bg-emerald-700 text-white shadow-xs"
                        : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                    }`}
                  >
                    Page {p.page_number}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
