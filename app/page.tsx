"use client";

import React, { useState, useEffect, useMemo, useRef } from "react";
import {
  Search,
  RotateCcw,
  Sparkles,
  Info,
  CheckCircle2,
  PackageX,
  History as HistoryIcon,
  Database,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import { Header } from "@/components/Header";
import { BottomNav, NavTab } from "@/components/BottomNav";
import { ActionTiles } from "@/components/ActionTiles";
import { CategoryBar, CategoryFilter } from "@/components/CategoryBar";
import { ProductCard } from "@/components/ProductCard";
import { SaleConfirmDialog } from "@/components/SaleConfirmDialog";
import { PinModal } from "@/components/PinModal";
import { AuthModal } from "@/components/AuthModal";
import { ProductItem, InventoryMovementRecord } from "@/lib/mock-data";
import { useLanguage } from "@/lib/language-context";
import { useAuth } from "@/lib/auth-context";
import {
  fetchShowroomProducts,
  executeStockChange,
  fetchMovementHistory,
} from "@/lib/services/inventory-service";

/**
 * BEGINNER LESSON: Production-Hardened Page
 * 1. Real Supabase Authentication: We read active role ('owner' | 'staff') from useAuth().
 * 2. Fail-Closed Reliability: If the database is unreachable, we show a clean friendly error,
 *    never fake/dummy data.
 * 3. 4-Digit PIN: Kept purely as a quick screen-lock against accidental taps on the showroom phone.
 */

export default function HomePage() {
  const { lang, t } = useLanguage();
  const { isAuthenticated, role, fullName, user } = useAuth();

  // App Mode State: "check" (default, read-only showroom mode) or "update" (owner mode)
  const [mode, setMode] = useState<"check" | "update">("check");
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Active Navigation Tab
  const [activeTab, setActiveTab] = useState<NavTab>("home");

  // Search & Category Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>("all");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Live Inventory State: Starts empty, populated strictly from real Supabase DB
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);

  // Inventory Movements History Log
  const [movements, setMovements] = useState<InventoryMovementRecord[]>([]);

  // Function to load live showroom data from Supabase
  const loadInitialData = async () => {
    setIsLoading(true);
    setDbError(null);
    try {
      const prodResult = await fetchShowroomProducts();
      if (prodResult.error) {
        setDbError(prodResult.error);
        setProducts([]);
      } else {
        setProducts(prodResult.products);
      }

      const histResult = await fetchMovementHistory();
      setMovements(histResult);
    } catch (err: any) {
      console.error("Database loading exception:", err);
      setDbError(err?.message || "Failed to connect to shop database.");
      setProducts([]);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // Confirmation Dialog State
  const [dialogState, setDialogState] = useState<{
    isOpen: boolean;
    product: ProductItem | null;
    changeType: "sale" | "return";
  }>({
    isOpen: false,
    product: null,
    changeType: "sale",
  });

  // Undo Toast State
  const [lastAction, setLastAction] = useState<{
    product: ProductItem;
    previousStock: number;
    newStock: number;
    type: "sale" | "return";
    timeoutId?: NodeJS.Timeout;
  } | null>(null);

  // Filtered Products based on Search Query and Category
  const filteredProducts = useMemo(() => {
    return products.filter((item) => {
      // Category filter match
      const matchesCategory =
        selectedCategory === "all" || item.category === selectedCategory;

      // Search match: matches brand, name, variant, or model number
      const q = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.brand.toLowerCase().includes(q) ||
        item.variant.toLowerCase().includes(q) ||
        item.modelNumber.toLowerCase().includes(q);

      return matchesCategory && matchesSearch;
    });
  }, [products, searchQuery, selectedCategory]);

  // Open "Sold 1" Action
  const handleSellOne = (product: ProductItem) => {
    if (!isAuthenticated) {
      // Security rule: Unauthenticated users in Check Mode cannot modify stock
      setIsAuthModalOpen(true);
      return;
    }

    setDialogState({
      isOpen: true,
      product,
      changeType: "sale",
    });
  };

  // Open "Return +1" Action
  const handleReturnOne = (product: ProductItem) => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      return;
    }

    setDialogState({
      isOpen: true,
      product,
      changeType: "return",
    });
  };

  // Confirm Stock Change (Executes atomic update on Supabase)
  const handleConfirmStockChange = async () => {
    if (!dialogState.product) return;

    if (!isAuthenticated) {
      setDialogState({ isOpen: false, product: null, changeType: "sale" });
      setIsAuthModalOpen(true);
      return;
    }

    const targetProduct = dialogState.product;
    const type = dialogState.changeType;
    const quantityChange = type === "sale" ? -1 : 1;
    const previousStock = targetProduct.currentStock;
    const newStock = Math.max(0, previousStock + quantityChange);

    // 1. Optimistic UI update
    setProducts((prev) =>
      prev.map((item) =>
        item.id === targetProduct.id
          ? {
              ...item,
              currentStock: newStock,
              lastVerifiedDate: new Date().toISOString(),
            }
          : item
      )
    );

    // Close dialog
    setDialogState({ isOpen: false, product: null, changeType: "sale" });

    // 2. Atomic Server Execution
    const performer = fullName || user?.email || (role === "owner" ? "Owner" : "Showroom Staff");
    const result = await executeStockChange({
      variantId: targetProduct.id,
      changeQty: quantityChange,
      reason: type === "sale" ? "sale" : "return",
      performedBy: performer,
      notes: type === "sale" ? "Customer Sale" : "Customer Return",
    });

    if (!result.success) {
      // If server failed (e.g. stock constraint), revert optimistic state
      alert(result.error || "Failed to update stock in database.");
      loadInitialData();
      return;
    }

    // 3. Record movement in history
    const newMovement: InventoryMovementRecord = {
      id: result.movementId || `mov-${Date.now()}`,
      productId: targetProduct.id,
      productName: targetProduct.name,
      variant: targetProduct.variant,
      modelNumber: targetProduct.modelNumber,
      type: type === "sale" ? "sale" : "return",
      quantityChange,
      previousStock,
      newStock,
      reason: type === "sale" ? "Customer Sale" : "Customer Return",
      timestamp: new Date().toISOString(),
      performedBy: performer,
    };
    setMovements((prev) => [newMovement, ...prev]);

    // 4. Setup 5-Second Undo Toast
    if (lastAction?.timeoutId) {
      clearTimeout(lastAction.timeoutId);
    }
    const timeoutId = setTimeout(() => {
      setLastAction(null);
    }, 5000);

    setLastAction({
      product: targetProduct,
      previousStock,
      newStock,
      type,
      timeoutId,
    });
  };

  // Undo the Last Stock Change
  const handleUndo = async () => {
    if (!lastAction) return;

    const { product, previousStock } = lastAction;
    const performer = fullName || user?.email || (role === "owner" ? "Owner" : "Showroom Staff");

    // Revert stock locally
    setProducts((prev) =>
      prev.map((item) =>
        item.id === product.id ? { ...item, currentStock: previousStock } : item
      )
    );

    // Sync undo with Supabase
    await executeStockChange({
      variantId: product.id,
      changeQty: previousStock - lastAction.newStock,
      reason: "manual_correction",
      performedBy: performer,
      notes: "Undo Last Action",
    });

    // Record undo movement
    const undoMovement: InventoryMovementRecord = {
      id: `mov-undo-${Date.now()}`,
      productId: product.id,
      productName: product.name,
      variant: product.variant,
      modelNumber: product.modelNumber,
      type: "correction",
      quantityChange: previousStock - lastAction.newStock,
      previousStock: lastAction.newStock,
      newStock: previousStock,
      reason: "Undo Last Action",
      timestamp: new Date().toISOString(),
      performedBy: performer,
    };
    setMovements((prev) => [undoMovement, ...prev]);

    if (lastAction.timeoutId) {
      clearTimeout(lastAction.timeoutId);
    }
    setLastAction(null);
  };

  // Quick Action Tile handlers
  const handleActionSoldClick = () => {
    if (!isAuthenticated) {
      setIsAuthModalOpen(true);
      return;
    }
    setActiveTab("home");
    searchInputRef.current?.focus();
  };

  const handleActionAddStockClick = () => {
    if (!isAuthenticated || role !== "owner") {
      setIsAuthModalOpen(true);
      return;
    }
    if (mode !== "update") {
      setIsPinModalOpen(true);
    } else {
      setActiveTab("catalog");
    }
  };

  const handleActionUploadBillClick = () => {
    if (!isAuthenticated || role !== "owner") {
      setIsAuthModalOpen(true);
      return;
    }
    setActiveTab("bills");
  };

  const handleActionSearchClick = () => {
    setActiveTab("home");
    searchInputRef.current?.focus();
  };

  return (
    <div className="min-h-screen pb-24 sm:pb-12 bg-slate-100/70">
      {/* 1. Sticky Header with Mode Switcher, Auth Button & Language Toggle */}
      <Header
        mode={mode}
        onOpenPinModal={() => setIsPinModalOpen(true)}
        onSwitchToCheckMode={() => setMode("check")}
        onOpenAuthModal={() => setIsAuthModalOpen(true)}
      />

      <main className="max-w-5xl mx-auto px-4 pt-4 flex flex-col gap-4">
        {/* Notice Bar: Displays Active Authentication Status & Role */}
        <div
          className={`flex items-center justify-between px-3.5 py-2.5 rounded-2xl text-xs font-medium border flex-wrap gap-2 shadow-2xs ${
            isAuthenticated
              ? role === "owner"
                ? "bg-amber-50 border-amber-300 text-amber-950 font-semibold"
                : "bg-emerald-50 border-emerald-300 text-emerald-950 font-semibold"
              : "bg-slate-50 border-slate-200 text-slate-700"
          }`}
        >
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 shrink-0 text-emerald-700" />
            <span>
              {isAuthenticated
                ? role === "owner"
                  ? lang === "hi"
                    ? `मालिक खाता: ${fullName || user?.email} (सभी अधिकार उपलब्ध)`
                    : `Owner Account: ${fullName || user?.email} (Full privileges)`
                  : lang === "hi"
                  ? `स्टाफ खाता: ${fullName || user?.email} (बिक्री/वापसी की अनुमति)`
                  : `Staff Account: ${fullName || user?.email} (Sales allowed)`
                : lang === "hi"
                ? "देखने का मोड: कोई भी रेट व स्टॉक देख सकता है। बदलाव के लिए लॉगिन करें।"
                : "Check Mode: Public showroom view. Log in to record sales."}
            </span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* Database status pill */}
            <span
              className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold border ${
                dbError
                  ? "bg-red-100 text-red-800 border-red-300"
                  : "bg-emerald-100 text-emerald-800 border-emerald-300"
              }`}
            >
              <Database className="w-3 h-3" />
              <span>{dbError ? "DB Offline" : "Live PostgreSQL"}</span>
            </span>

            {/* Quick Action Button */}
            {!isAuthenticated ? (
              <button
                onClick={() => setIsAuthModalOpen(true)}
                className="font-bold underline text-slate-900 hover:text-emerald-700 ml-1"
              >
                {lang === "hi" ? "लॉगिन करें" : "Staff Login"}
              </button>
            ) : mode === "check" && role === "owner" ? (
              <button
                onClick={() => setIsPinModalOpen(true)}
                className="font-bold underline text-amber-900 hover:text-amber-950 ml-1"
              >
                {lang === "hi" ? "मालिक मोड (PIN)" : "Unlock Owner Mode"}
              </button>
            ) : null}
          </div>
        </div>

        {/* Database Connection Error View: Never show fake mock data! */}
        {dbError ? (
          <div className="bg-white rounded-3xl p-8 border border-red-200 text-center flex flex-col items-center gap-3 shadow-xs">
            <div className="w-14 h-14 rounded-2xl bg-red-100 text-red-600 flex items-center justify-center">
              <WifiOff className="w-7 h-7" />
            </div>
            <h3 className="text-lg font-bold text-slate-900">
              {lang === "hi"
                ? "दुकान के डेटाबेस से संपर्क नहीं हो पा रहा है"
                : "Unable to Connect to Shop Database"}
            </h3>
            <p className="text-xs text-slate-500 max-w-md">
              {lang === "hi"
                ? "कृपया अपना इंटरनेट कनेक्शन या .env.local में Supabase सेटिंग्स जांचें। सुरक्षा नियमों के अनुसार कोई नकली डेटा नहीं दिखाया जाएगा।"
                : "Please check your internet connection or Supabase settings in .env.local. Following security rules, no fake data will be shown."}
            </p>
            <button
              onClick={loadInitialData}
              className="mt-2 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800 transition-all active:scale-95 shadow-sm"
            >
              <RefreshCw className="w-4 h-4" />
              <span>{lang === "hi" ? "दोबारा कोशिश करें" : "Retry Connection"}</span>
            </button>
          </div>
        ) : (
          <>
            {/* 2. Big Blinkit-Style Search Bar */}
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Search className="w-5 h-5" />
              </div>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t.searchPlaceholder}
                className="w-full pl-10 pr-10 py-3.5 rounded-2xl bg-white border border-slate-200/90 text-sm font-medium text-slate-900 placeholder-slate-400 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 focus:border-transparent shadow-xs transition-all"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-xs font-bold text-slate-400 hover:text-slate-600"
                >
                  ✕
                </button>
              )}
            </div>

            {/* 3. Four Big Action Buttons (Blinkit Quick Tiles) */}
            {activeTab === "home" && !searchQuery && (
              <ActionTiles
                onSoldClick={handleActionSoldClick}
                onAddStockClick={handleActionAddStockClick}
                onUploadBillClick={handleActionUploadBillClick}
                onSearchClick={handleActionSearchClick}
              />
            )}

            {/* 4. Category Filter Bar */}
            <div className="pt-1">
              <div className="flex items-center justify-between mb-1.5 px-0.5">
                <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  {lang === "hi" ? "कैटेगरी चुनें" : "Categories"}
                </h2>
                <span className="text-[11px] font-semibold text-slate-400">
                  {filteredProducts.length} {t.showingItems}
                </span>
              </div>
              <CategoryBar
                selectedCategory={selectedCategory}
                onSelectCategory={setSelectedCategory}
              />
            </div>

            {/* 5. Main Content Switching based on Tab */}
            {isLoading ? (
              <div className="bg-white rounded-3xl p-12 border border-slate-200 text-center flex flex-col items-center gap-3">
                <RefreshCw className="w-8 h-8 text-emerald-600 animate-spin" />
                <p className="text-sm font-bold text-slate-700">
                  {lang === "hi" ? "दुकान का सामान लोड हो रहा है..." : "Loading showroom inventory..."}
                </p>
              </div>
            ) : activeTab === "bills" ? (
              /* Tab: Scan Bill Preview for Phase 6 */
              <div className="bg-white rounded-3xl p-6 border border-slate-200 text-center flex flex-col items-center gap-3 shadow-xs">
                <div className="w-14 h-14 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                  <Sparkles className="w-7 h-7" />
                </div>
                <h3 className="text-lg font-bold text-slate-900">
                  {lang === "hi" ? "एआई बिल स्कैनर (फेज 6)" : "AI Purchase Bill Scanner"}
                </h3>
                <p className="text-xs text-slate-500 max-w-md">
                  {lang === "hi"
                    ? "यह फीचर फेज 6 में क्लॉड विजन (Claude Vision) के साथ जुड़ जाएगा। पर्ची या बिल की फोटो अपलोड करने पर सामान और खरीद रेट अपने आप पढ़ लिए जाएंगे।"
                    : "This feature will connect in Phase 6 with Claude Vision AI. Upload any supplier invoice PDF or photo to automatically extract models, quantities, and purchase prices."}
                </p>
                <button
                  onClick={() => setActiveTab("home")}
                  className="mt-2 px-4 py-2 rounded-xl bg-slate-900 text-white text-xs font-bold hover:bg-slate-800"
                >
                  {lang === "hi" ? "दुकान के सामान पर वापस जाएँ" : "Back to Items"}
                </button>
              </div>
            ) : activeTab === "history" ? (
              /* Tab: Inventory Movements History */
              <div className="bg-white rounded-3xl p-5 border border-slate-200 shadow-xs flex flex-col gap-3">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3">
                  <div className="flex items-center gap-2">
                    <HistoryIcon className="w-5 h-5 text-emerald-600" />
                    <h3 className="font-bold text-slate-900 text-base">
                      {lang === "hi" ? "स्टॉक लेन-देन का इतिहास" : "Stock Movement History"}
                    </h3>
                  </div>
                  <span className="text-xs font-semibold text-slate-500">
                    {movements.length} {lang === "hi" ? "रिकॉर्ड" : "entries"}
                  </span>
                </div>

                {movements.length === 0 ? (
                  <p className="text-xs text-slate-400 text-center py-8">
                    {lang === "hi"
                      ? "अभी तक कोई लेन-देन नहीं हुआ है। सामान बिकने पर '1 बिका' दबाएं।"
                      : "No stock changes recorded yet. Tap 'Sold 1' on any product to see the audit log."}
                  </p>
                ) : (
                  <div className="flex flex-col divide-y divide-slate-100">
                    {movements.map((mov) => (
                      <div key={mov.id} className="py-2.5 flex items-center justify-between text-xs">
                        <div>
                          <p className="font-bold text-slate-800">{mov.productName}</p>
                          <p className="text-slate-400 text-[11px]">
                            {mov.modelNumber} • {mov.reason} ({mov.performedBy})
                          </p>
                        </div>
                        <div className="text-right">
                          <span
                            className={`font-black text-sm ${
                              mov.quantityChange < 0 ? "text-emerald-600" : "text-blue-600"
                            }`}
                          >
                            {mov.quantityChange > 0 ? `+${mov.quantityChange}` : mov.quantityChange}
                          </span>
                          <p className="text-[10px] text-slate-400">
                            {mov.previousStock} → {mov.newStock}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              /* Tab: Home & Catalog Products Grid */
              <div>
                {filteredProducts.length === 0 ? (
                  <div className="bg-white rounded-3xl p-10 border border-slate-200 text-center flex flex-col items-center gap-3">
                    <PackageX className="w-12 h-12 text-slate-300" />
                    <h3 className="font-bold text-slate-700 text-base">
                      {lang === "hi" ? "कोई सामान नहीं मिला" : "No products found"}
                    </h3>
                    <p className="text-xs text-slate-400 max-w-xs">
                      {lang === "hi"
                        ? "कृपया स्पेलिंग चेक करें या दूसरी कैटेगरी चुनें।"
                        : "Try checking the spelling or switch category to find what you need."}
                    </p>
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        setSelectedCategory("all");
                      }}
                      className="px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100"
                    >
                      {lang === "hi" ? "सभी सामान देखें" : "View All Products"}
                    </button>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                    {filteredProducts.map((product) => (
                      <ProductCard
                        key={product.id}
                        product={product}
                        mode={mode}
                        onSellOne={handleSellOne}
                        onReturnOne={handleReturnOne}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Floating 5-Second Undo Toast */}
      {lastAction && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-950 text-white px-4 py-2.5 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-800 animate-in slide-in-from-bottom-5">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <div className="text-xs">
            <span className="font-bold">{lastAction.product.modelNumber}:</span>{" "}
            {lastAction.previousStock} → {lastAction.newStock}
          </div>
          <button
            onClick={handleUndo}
            className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white font-bold text-xs transition-colors active:scale-95"
          >
            <RotateCcw className="w-3 h-3" />
            <span>{t.undoBtn}</span>
          </button>
        </div>
      )}

      {/* Sale/Return Confirmation Dialog */}
      <SaleConfirmDialog
        isOpen={dialogState.isOpen}
        product={dialogState.product}
        changeType={dialogState.changeType}
        onConfirm={handleConfirmStockChange}
        onCancel={() =>
          setDialogState({ isOpen: false, product: null, changeType: "sale" })
        }
      />

      {/* Owner PIN Convenience Lock */}
      <PinModal
        isOpen={isPinModalOpen}
        onSuccess={() => {
          setMode("update");
          setIsPinModalOpen(false);
        }}
        onClose={() => setIsPinModalOpen(false)}
      />

      {/* Real Supabase Authentication Modal */}
      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* Mobile Bottom Navigation */}
      <BottomNav activeTab={activeTab} onSelectTab={setActiveTab} />
    </div>
  );
}
