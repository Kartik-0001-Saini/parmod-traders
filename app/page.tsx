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
} from "lucide-react";
import { Header } from "@/components/Header";
import { BottomNav, NavTab } from "@/components/BottomNav";
import { ActionTiles } from "@/components/ActionTiles";
import { CategoryBar, CategoryFilter } from "@/components/CategoryBar";
import { ProductCard } from "@/components/ProductCard";
import { SaleConfirmDialog } from "@/components/SaleConfirmDialog";
import { PinModal } from "@/components/PinModal";
import {
  INITIAL_PRODUCTS,
  ProductItem,
  InventoryMovementRecord,
} from "@/lib/mock-data";
import { useLanguage } from "@/lib/language-context";
import {
  fetchShowroomProducts,
  executeStockChange,
  fetchMovementHistory,
} from "@/lib/services/inventory-service";

/**
 * BEGINNER LESSON: Next.js Client Component ("use client")
 * Because this page uses interactive features like search typing, button clicks,
 * dialog popups, and state (useState), we mark it with "use client".
 */

export default function HomePage() {
  const { lang, t } = useLanguage();

  // App Mode State: "check" (default, read-only showroom mode) or "update" (owner mode)
  const [mode, setMode] = useState<"check" | "update">("check");
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);

  // Active Navigation Tab
  const [activeTab, setActiveTab] = useState<NavTab>("home");

  // Search & Category Filter
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<CategoryFilter>("all");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Live Inventory State (defaults to initial electronics showroom mock data, then loads from Supabase)
  const [products, setProducts] = useState<ProductItem[]>(INITIAL_PRODUCTS);
  const [isLiveFromSupabase, setIsLiveFromSupabase] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Inventory Movements History Log
  const [movements, setMovements] = useState<InventoryMovementRecord[]>([]);

  // Load real catalog & movements from Supabase on start
  useEffect(() => {
    async function loadInitialData() {
      setIsLoading(true);
      try {
        const prodResult = await fetchShowroomProducts();
        setProducts(prodResult.products);
        setIsLiveFromSupabase(prodResult.isFromSupabase);

        const histResult = await fetchMovementHistory();
        if (histResult.length > 0) {
          setMovements(histResult);
        }
      } catch (err) {
        console.warn("Could not load from Supabase, using local defaults:", err);
      } finally {
        setIsLoading(false);
      }
    }
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

  // Open "Sold 1" Confirmation Dialog
  const handleSellOne = (product: ProductItem) => {
    setDialogState({
      isOpen: true,
      product,
      changeType: "sale",
    });
  };

  // Open "Return +1" Confirmation Dialog
  const handleReturnOne = (product: ProductItem) => {
    setDialogState({
      isOpen: true,
      product,
      changeType: "return",
    });
  };

  // Confirm Stock Change (Applies the update & records movement)
  const handleConfirmStockChange = () => {
    if (!dialogState.product) return;

    const targetProduct = dialogState.product;
    const type = dialogState.changeType;
    const quantityChange = type === "sale" ? -1 : 1;
    const previousStock = targetProduct.currentStock;
    const newStock = Math.max(0, previousStock + quantityChange); // Rule: Stock can NEVER go below 0

    // Update Product list locally for immediate feedback
    setProducts((prev) =>
      prev.map((item) =>
        item.id === targetProduct.id
          ? {
              ...item,
              currentStock: newStock,
              lastVerifiedDate: new Date().toISOString(), // resets verification timer
            }
          : item
      )
    );

    // Sync atomically with Supabase PostgreSQL if connected
    executeStockChange({
      variantId: targetProduct.id,
      changeQty: quantityChange,
      reason: type === "sale" ? "sale" : "return",
      performedBy: mode === "update" ? "Owner" : "Showroom Staff",
      notes: type === "sale" ? "Customer Sale" : "Customer Return",
    }).then((res) => {
      if (!res.success && res.error) {
        console.warn("Supabase update error:", res.error);
      }
    });

    // Record movement in history
    const newMovement: InventoryMovementRecord = {
      id: `mov-${Date.now()}`,
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
      performedBy: mode === "update" ? "Owner" : "Showroom Staff",
    };
    setMovements((prev) => [newMovement, ...prev]);

    // Close dialog
    setDialogState({ isOpen: false, product: null, changeType: "sale" });

    // Setup 5-Second Undo Toast
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
  const handleUndo = () => {
    if (!lastAction) return;

    const { product, previousStock } = lastAction;

    // Revert stock locally
    setProducts((prev) =>
      prev.map((item) =>
        item.id === product.id ? { ...item, currentStock: previousStock } : item
      )
    );

    // Sync undo with Supabase PostgreSQL
    executeStockChange({
      variantId: product.id,
      changeQty: previousStock - lastAction.newStock,
      reason: "manual_correction",
      performedBy: mode === "update" ? "Owner" : "Showroom Staff",
      notes: "Undo Last Action",
    }).then((res) => {
      if (!res.success && res.error) {
        console.warn("Supabase undo error:", res.error);
      }
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
      performedBy: mode === "update" ? "Owner" : "Showroom Staff",
    };
    setMovements((prev) => [undoMovement, ...prev]);

    if (lastAction.timeoutId) {
      clearTimeout(lastAction.timeoutId);
    }
    setLastAction(null);
  };

  // Quick Action Tile handlers
  const handleActionSoldClick = () => {
    // Focus search or show helpful toast to tap "Sold 1" on desired product
    setActiveTab("home");
    searchInputRef.current?.focus();
  };

  const handleActionAddStockClick = () => {
    if (mode !== "update") {
      setIsPinModalOpen(true);
    } else {
      setActiveTab("catalog");
    }
  };

  const handleActionUploadBillClick = () => {
    setActiveTab("bills");
  };

  const handleActionSearchClick = () => {
    setActiveTab("home");
    searchInputRef.current?.focus();
  };

  return (
    <div className="min-h-screen pb-24 sm:pb-12 bg-slate-100/70">
      {/* 1. Sticky Header with Mode Switcher & Language Toggle */}
      <Header
        mode={mode}
        onOpenPinModal={() => setIsPinModalOpen(true)}
        onSwitchToCheckMode={() => setMode("check")}
      />

      <main className="max-w-5xl mx-auto px-4 pt-4 flex flex-col gap-4">
        {/* Check Mode vs Update Mode Notice Bar + Database Status */}
        <div
          className={`flex items-center justify-between px-3.5 py-2 rounded-xl text-xs font-medium border flex-wrap gap-2 ${
            mode === "check"
              ? "bg-emerald-50/90 border-emerald-200 text-emerald-900"
              : "bg-amber-50/90 border-amber-300 text-amber-950 font-semibold"
          }`}
        >
          <div className="flex items-center gap-2">
            <Info className="w-4 h-4 shrink-0" />
            <span>
              {mode === "check"
                ? lang === "hi"
                  ? "देखने का मोड सक्रिय है: कोई भी रेट या स्टॉक देख सकता है।"
                  : "Check Mode active: Safe for showroom floor browsing."
                : lang === "hi"
                ? "मालिक मोड अनलॉक है: स्टॉक व रेट में बदलाव संभव हैं।"
                : "Owner Update Mode unlocked: Ready for stock & price updates."}
            </span>
          </div>

          <div className="flex items-center gap-2 ml-auto">
            {/* Supabase Connection Status Pill */}
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold border ${
                isLiveFromSupabase
                  ? "bg-emerald-100 text-emerald-800 border-emerald-300"
                  : "bg-slate-100 text-slate-600 border-slate-300"
              }`}
              title={isLiveFromSupabase ? "Connected to Supabase PostgreSQL" : "Using local data until Supabase is connected"}
            >
              <Database className="w-3 h-3" />
              <span>
                {isLiveFromSupabase
                  ? "Supabase Live"
                  : isLoading
                  ? "Connecting..."
                  : "Demo Catalog"}
              </span>
            </span>

            {mode === "check" && (
              <button
                onClick={() => setIsPinModalOpen(true)}
                className="font-bold underline text-emerald-800 hover:text-emerald-950 shrink-0"
              >
                {lang === "hi" ? "पिन डालें" : "Owner PIN"}
              </button>
            )}
          </div>
        </div>

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
        {activeTab === "bills" ? (
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

      {/* Owner PIN Unlock Modal */}
      <PinModal
        isOpen={isPinModalOpen}
        onSuccess={() => {
          setMode("update");
          setIsPinModalOpen(false);
        }}
        onClose={() => setIsPinModalOpen(false)}
      />

      {/* Mobile Bottom Navigation */}
      <BottomNav activeTab={activeTab} onSelectTab={setActiveTab} />
    </div>
  );
}
