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
  PackagePlus,
} from "lucide-react";
import { Header } from "@/components/Header";
import { BottomNav, DesktopTabs, NavTab } from "@/components/BottomNav";
import { LoginScreen, AuthLoadingScreen } from "@/components/LoginScreen";
import { ActionTiles } from "@/components/ActionTiles";
import {
  DynamicFilters,
  ActiveFilters,
} from "@/components/DynamicFilters";
import { ProductCard } from "@/components/ProductCard";
import { ProductCardSkeleton } from "@/components/ProductCardSkeleton";
import { SaleConfirmDialog } from "@/components/SaleConfirmDialog";
import { PinModal } from "@/components/PinModal";
import { AuthModal } from "@/components/AuthModal";
import { AddProductModal } from "@/components/AddProductModal";
import { EditProductModal } from "@/components/EditProductModal";
import { AdjustStockModal } from "@/components/AdjustStockModal";
import { HistoryView } from "@/components/HistoryView";
import { BillsManager } from "@/components/BillsManager";
import { ProductItem, InventoryMovementRecord } from "@/lib/mock-data";
import { useLanguage } from "@/lib/language-context";
import { useAuth } from "@/lib/auth-context";
import { searchProducts } from "@/lib/search-engine";
import { getDaysAgo } from "@/lib/utils";
import { groupAndSortProducts, SortOption } from "@/lib/sort-engine";
import {
  fetchShowroomProducts,
  fetchShowroomCategories,
  fetchOwnerCostMap,
  extractDynamicFilterOptions,
  executeStockChange,
  fetchMovementHistory,
  DbCategory,
} from "@/lib/services/inventory-service";

/**
 * BEGINNER LESSON: Phase 3 Check Mode
 * 1. 5-Second Search: searchProducts() uses token normalization and typo tolerance
 * 2. Dynamic DB Filters: extractDynamicFilterOptions() pulls live brands and specs from PostgreSQL
 * 3. Zero-Knowledge Costs: fetchOwnerCostMap() executes ONLY if user is Owner (RLS protected)
 * 4. Skeleton Screen: ProductCardSkeleton renders instant card outlines while loading
 */

/**
 * Login gate: nothing (no inventory, search, bills) is shown or fetched until
 * a staff/owner account is logged in. ShowroomApp is keyed by user id, so
 * logging out unmounts it and clears all loaded data from memory.
 */
export default function HomePage() {
  const { isAuthenticated, isLoading, user } = useAuth();

  if (isLoading) return <AuthLoadingScreen />;
  if (!isAuthenticated || !user) return <LoginScreen />;

  return <ShowroomApp key={user.id} />;
}

function ShowroomApp() {
  const { lang, t } = useLanguage();
  const { isAuthenticated, role, fullName, user, isOwner } = useAuth();

  // App Mode State: "check" (default, read-only showroom mode) or "update" (owner mode)
  const [mode, setMode] = useState<"check" | "update">("check");
  const [isPinModalOpen, setIsPinModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Active Navigation Tab
  const [activeTab, setActiveTab] = useState<NavTab>("home");

  // Search Query
  const [searchQuery, setSearchQuery] = useState("");
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Dynamic Filters State
  const [activeFilters, setActiveFilters] = useState<ActiveFilters>({
    category: "all",
    brand: "all",
    specKey: null,
    specValue: null,
    stockStatus: "all",
  });

  // Sorting & Grouping Option
  const [sortOption, setSortOption] = useState<SortOption>("size_desc");

  // Owner Management Modals State
  const [isAddProductModalOpen, setIsAddProductModalOpen] = useState(false);
  const [editProductState, setEditProductState] = useState<{
    isOpen: boolean;
    product: ProductItem | null;
  }>({ isOpen: false, product: null });
  const [adjustStockState, setAdjustStockState] = useState<{
    isOpen: boolean;
    product: ProductItem | null;
  }>({ isOpen: false, product: null });

  // Live Inventory State: Starts empty, populated strictly from real Supabase DB
  const [products, setProducts] = useState<ProductItem[]>([]);
  const [categories, setCategories] = useState<DbCategory[]>([]);
  const [ownerCostMap, setOwnerCostMap] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);

  // Inventory Movements History Log
  const [movements, setMovements] = useState<InventoryMovementRecord[]>([]);

  // Function to load live showroom data from Supabase in ONE single request batch
  const loadInitialData = async () => {
    setIsLoading(true);
    setDbError(null);
    try {
      const [prodResult, catResult, histResult] = await Promise.all([
        fetchShowroomProducts(),
        fetchShowroomCategories(),
        fetchMovementHistory(),
      ]);

      if (prodResult.error) {
        setDbError(prodResult.error);
        setProducts([]);
      } else {
        setProducts(prodResult.products);
      }

      setCategories(catResult.categories || []);
      setMovements(histResult || []);
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

  // After a purchase bill is added to stock: reload products, history and costs quietly
  // (no loading skeleton, so the Bills screen stays open).
  const refreshAfterStockChange = async () => {
    const [prodResult, histResult] = await Promise.all([fetchShowroomProducts(), fetchMovementHistory()]);
    if (!prodResult.error) setProducts(prodResult.products);
    setMovements(histResult || []);
    if (isOwner) setOwnerCostMap(await fetchOwnerCostMap());
  };

  // Fetch Owner Purchase Costs securely ONLY when user is authenticated as Owner
  useEffect(() => {
    if (isOwner) {
      fetchOwnerCostMap().then((costs) => {
        setOwnerCostMap(costs);
      });
    } else {
      // Clear all cost memory if logged out or Staff
      setOwnerCostMap({});
    }
  }, [isOwner]);

  // Extract dynamic filter options directly from the database catalog
  const dynamicFilterOptions = useMemo(() => {
    return extractDynamicFilterOptions(products, categories);
  }, [products, categories]);

  // Reset all filters helper
  const handleResetFilters = () => {
    setActiveFilters({
      category: "all",
      brand: "all",
      specKey: null,
      specValue: null,
      stockStatus: "all",
    });
    setSearchQuery("");
  };

  // Filter & Search Pipeline
  const filteredProducts = useMemo(() => {
    // Step 1: Filter by Category, Brand, Specs, and Stock Status
    const baseFiltered = products.filter((item) => {
      // Category Filter
      if (activeFilters.category !== "all" && item.category !== activeFilters.category) {
        return false;
      }

      // Brand Filter
      if (activeFilters.brand !== "all" && item.brand.toLowerCase() !== activeFilters.brand.toLowerCase()) {
        return false;
      }

      // Spec / Attribute Filter (e.g. Capacity = '8 KG')
      if (activeFilters.specKey && activeFilters.specValue) {
        const itemVal = item.specifications?.[activeFilters.specKey];
        if (!itemVal || itemVal.toLowerCase() !== activeFilters.specValue.toLowerCase()) {
          return false;
        }
      }

      // Stock Status Filter
      if (activeFilters.stockStatus === "in_stock") {
        if (item.currentStock <= item.lowStockThreshold) return false;
      } else if (activeFilters.stockStatus === "low_stock") {
        if (item.currentStock <= 0 || item.currentStock > item.lowStockThreshold) return false;
      } else if (activeFilters.stockStatus === "out_of_stock") {
        if (item.currentStock > 0) return false;
      } else if (activeFilters.stockStatus === "needs_verification") {
        const days = getDaysAgo(item.lastVerifiedDate).days;
        if (days < 7) return false;
      }

      return true;
    });

    // Step 2: Apply Smart 5-Second Typo-Tolerant Search
    if (!searchQuery.trim()) {
      return baseFiltered;
    }

    return searchProducts(baseFiltered, searchQuery);
  }, [products, activeFilters, searchQuery]);

  // Step 3: Group by HSN Tax Code and Sort inside each group according to showroom rules
  const hsnGroups = useMemo(() => {
    return groupAndSortProducts(filteredProducts, sortOption);
  }, [filteredProducts, sortOption]);

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

  // Undo Toast State (10-Second Window with Database Movement Reference)
  const [lastAction, setLastAction] = useState<{
    movementId: string;
    product: ProductItem;
    previousStock: number;
    newStock: number;
    type: "sale" | "return";
    timeoutId?: NodeJS.Timeout;
    intervalId?: NodeJS.Timeout;
  } | null>(null);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(10);

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
      notes: type === "sale" ? "Customer Sale" : "Customer Return",
    });

    if (!result.success) {
      // Friendly Concurrency Conflict Handling
      if (
        result.error?.includes("INSUFFICIENT_STOCK") ||
        result.error?.includes("Stock cannot go below 0")
      ) {
        alert(
          lang === "hi"
            ? `⚠️ स्टॉक बदल चुका है!\n\nकिसी और ने अभी-अभी यह आइटम बेच दिया है या स्टॉक खत्म हो चुका है।\nदुकान का कैटलॉग ताज़ा किया जा रहा है...`
            : `⚠️ Stock conflict!\n\nSomeone else just updated this item, or stock reached 0.\nRefreshing showroom catalog...`
        );
      } else {
        alert(result.error || "Failed to update stock in database.");
      }
      loadInitialData();
      return;
    }

    // 3. Record movement in history
    const newMovementId = result.movementId || `mov-${Date.now()}`;
    const newMovement: InventoryMovementRecord = {
      id: newMovementId,
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

    // 4. Setup 10-Second Undo Toast with Timer Countdown
    if (lastAction?.timeoutId) {
      clearTimeout(lastAction.timeoutId);
    }
    if (lastAction?.intervalId) {
      clearInterval(lastAction.intervalId);
    }

    setUndoSecondsLeft(10);

    const intervalId = setInterval(() => {
      setUndoSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(intervalId);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    const timeoutId = setTimeout(() => {
      clearInterval(intervalId);
      setLastAction(null);
    }, 10000);

    setLastAction({
      movementId: newMovementId,
      product: targetProduct,
      previousStock,
      newStock,
      type,
      timeoutId,
      intervalId,
    });
  };

  // Undo the Last Stock Change (Strictly links to original movement ID)
  const handleUndo = async () => {
    if (!lastAction) return;

    const { movementId, product, previousStock, type } = lastAction;
    const performer = fullName || user?.email || (role === "owner" ? "Owner" : "Showroom Staff");
    const undoQty = type === "sale" ? 1 : -1;

    // Clear timers immediately
    if (lastAction.timeoutId) clearTimeout(lastAction.timeoutId);
    if (lastAction.intervalId) clearInterval(lastAction.intervalId);
    setLastAction(null);

    // 1. Optimistic Revert
    setProducts((prev) =>
      prev.map((item) =>
        item.id === product.id ? { ...item, currentStock: previousStock } : item
      )
    );

    // 2. Atomic Database Execution with strict original movement linkage
    const res = await executeStockChange({
      variantId: product.id,
      changeQty: undoQty,
      reason: "undo",
      originalMovementId: movementId,
      notes: `Undo of ${type === "sale" ? "Sale" : "Customer Return"}`,
    });

    if (!res.success) {
      // Friendly Security & Expiry Feedback
      let friendlyMsg = res.error || "Failed to undo action.";
      if (res.error?.includes("ALREADY_UNDONE")) {
        friendlyMsg =
          lang === "hi"
            ? "यह सौदा पहले ही अनडू (रद्द) किया जा चुका है।"
            : "This action has already been undone.";
      } else if (res.error?.includes("UNDO_EXPIRED")) {
        friendlyMsg =
          lang === "hi"
            ? "10 मिनट की अनडू समय सीमा समाप्त हो चुकी है।"
            : "The 10-minute undo window has expired.";
      } else if (res.error?.includes("UNAUTHORIZED_UNDO")) {
        friendlyMsg =
          lang === "hi"
            ? "सुरक्षा नियम: स्टाफ केवल अपने खुद के सौदे अनडू कर सकता है।"
            : "Security rule: Staff can only undo their own actions.";
      } else if (res.error?.includes("INSUFFICIENT_STOCK")) {
        friendlyMsg =
          lang === "hi"
            ? "दुकान में स्टॉक 0 से कम नहीं हो सकता!"
            : "Stock cannot drop below 0!";
      }

      alert(friendlyMsg);
      loadInitialData();
      return;
    }

    // 3. Refresh Movement History from Database
    const freshMovements = await fetchMovementHistory();
    setMovements(freshMovements);
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
    setAdjustStockState({ isOpen: true, product: null });
  };

  const handleOpenAddProduct = () => {
    if (!isAuthenticated || role !== "owner") {
      setIsAuthModalOpen(true);
      return;
    }
    setIsAddProductModalOpen(true);
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
      >
        {/* Laptop / desktop navigation (phones use the BottomNav below) */}
        <DesktopTabs activeTab={activeTab} onSelectTab={setActiveTab} />
      </Header>

      <main className="max-w-5xl mx-auto px-4 pt-4 flex flex-col gap-3.5">
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
                    ? `मालिक खाता: ${fullName || user?.email} (खरीद रेट व सभी अधिकार उपलब्ध)`
                    : `Owner Account: ${fullName || user?.email} (Costs & Full privileges)`
                  : lang === "hi"
                  ? `स्टाफ खाता: ${fullName || user?.email} (बिक्री/वापसी की अनुमति)`
                  : `Staff Account: ${fullName || user?.email} (Sales allowed)`
                : lang === "hi"
                ? "देखने का मोड: कोई भी रेट व स्टॉक देख सकता है। बिक्री दर्ज करने के लिए लॉगिन करें।"
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
            {/* 2. Big Blinkit-Style Search Bar (Under 5 seconds showroom lookup) */}
            {(activeTab === "home" || activeTab === "catalog") && (
            <div className="relative">
              <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                <Search className="w-5 h-5" />
              </div>
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={lang === "hi" ? "सामान, ब्रांड, मॉडल या क्षमता खोजें (जैसे Godrej 8kg)..." : "Search brand, model or size (e.g. Godrej 8kg, Voltas 1.5)..."}
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
            )}

            {/* 4. Dynamic Database Filters (Categories, Brands, Specs, Stock Status) */}
            {(activeTab === "home" || activeTab === "catalog") && (
              <DynamicFilters
                filterOptions={dynamicFilterOptions}
                activeFilters={activeFilters}
                onChangeFilters={setActiveFilters}
                onResetFilters={handleResetFilters}
                totalFilteredCount={filteredProducts.length}
                sortOption={sortOption}
                onChangeSortOption={setSortOption}
              />
            )}

            {/* 3. Four Big Action Buttons (Blinkit Quick Tiles) */}
            {activeTab === "home" && !searchQuery && (
              <ActionTiles
                onSoldClick={handleActionSoldClick}
                onAddStockClick={handleActionAddStockClick}
                onUploadBillClick={handleActionUploadBillClick}
                onSearchClick={handleActionSearchClick}
              />
            )}

            {/* Owner Add Product Button Banner */}
            {isOwner && (
              <div className="flex items-center justify-between bg-amber-500/10 border border-amber-300/80 px-4 py-2.5 rounded-2xl">
                <div className="flex items-center gap-2">
                  <PackagePlus className="w-4 h-4 text-amber-700" />
                  <span className="text-xs font-bold text-amber-950">
                    {lang === "hi" ? "दुकान में नया सामान जोड़ना है?" : "Want to add a new product model?"}
                  </span>
                </div>
                <button
                  onClick={handleOpenAddProduct}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs shadow-xs active:scale-95 transition-all"
                >
                  <PackagePlus className="w-3.5 h-3.5" />
                  <span>{lang === "hi" ? "+ नया सामान जोड़ें" : "+ Add Product"}</span>
                </button>
              </div>
            )}

            {/* 5. Main Content Switching based on Tab */}
            {isLoading ? (
              /* Instant Skeleton Loader UI (Zero Layout Shift) */
              <ProductCardSkeleton count={6} />
            ) : activeTab === "bills" ? (
              /* Tab: Purchase Bills Management (Phase 6 Sub-Phase A) */
              <BillsManager
                onOpenAuthModal={() => setIsAuthModalOpen(true)}
                onOpenPinModal={() => setIsPinModalOpen(true)}
                onStockChanged={refreshAfterStockChange}
              />
            ) : activeTab === "history" ? (
              /* Tab: Inventory Movements History (Phase 4 Filtered Audit View) */
              <HistoryView movements={movements} onRefresh={loadInitialData} />
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
                        ? "कृपया स्पेलिंग चेक करें या फ़िल्टर रीसेट करें।"
                        : "Try checking your spelling or clear some active filters."}
                    </p>
                    <button
                      onClick={handleResetFilters}
                      className="px-4 py-2 rounded-xl bg-emerald-50 text-emerald-700 text-xs font-bold hover:bg-emerald-100"
                    >
                      {lang === "hi" ? "सभी फ़िल्टर हटाएं" : "Clear All Filters"}
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-col gap-5">
                    {hsnGroups.map((group) => (
                      <div key={group.hsnCode} className="flex flex-col gap-2.5">
                        {/* HSN Group Header Banner */}
                        <div className="flex items-center justify-between bg-white px-3.5 py-2 rounded-2xl border border-slate-200/90 shadow-2xs">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-xs font-black bg-slate-900 text-white px-2 py-0.5 rounded-md">
                              HSN: {group.hsnCode}
                            </span>
                            <span className="text-xs font-bold text-slate-800">
                              {group.items[0]?.categoryNameEn || "Showroom Category"} • {group.items.length}{" "}
                              {lang === "hi" ? "मॉडल" : "models"}
                            </span>
                          </div>
                          <span className="text-[10px] font-semibold text-slate-400">
                            {sortOption.startsWith("size")
                              ? lang === "hi"
                                ? "साइज अनुसार"
                                : "Sorted by Size"
                              : sortOption.startsWith("price")
                              ? lang === "hi"
                                ? "रेट अनुसार"
                                : "Sorted by Price"
                              : lang === "hi"
                              ? "ब्रांड अनुसार"
                              : "Sorted by Brand"}
                          </span>
                        </div>

                        {/* Product Cards Grid */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                          {group.items.map((product) => (
                            <ProductCard
                              key={product.id}
                              product={product}
                              mode={mode}
                              onSellOne={handleSellOne}
                              onReturnOne={handleReturnOne}
                              onEditProduct={(p) => setEditProductState({ isOpen: true, product: p })}
                              onAdjustStock={(p) => setAdjustStockState({ isOpen: true, product: p })}
                              isOwner={isOwner}
                              ownerPurchasePrice={ownerCostMap[product.id]}
                            />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {/* Floating 10-Second Undo Toast */}
      {lastAction && (
        <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-950 text-white px-4 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-slate-800 animate-in slide-in-from-bottom-5 max-w-sm w-full mx-auto">
          <div className="w-8 h-8 rounded-xl bg-purple-900/60 border border-purple-500/40 text-purple-300 flex items-center justify-center shrink-0">
            <RotateCcw className="w-4 h-4" />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <div className="flex items-center justify-between text-xs font-bold">
              <span className="truncate">{lastAction.product.modelNumber}</span>
              <span className="text-[10px] text-purple-300 font-mono bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-800">
                {undoSecondsLeft}s
              </span>
            </div>
            <p className="text-[11px] text-slate-400 truncate">
              {lastAction.type === "sale"
                ? lang === "hi"
                  ? "बिक्री दर्ज हुई"
                  : "Sale recorded"
                : lang === "hi"
                ? "वापसी दर्ज हुई"
                : "Return recorded"}{" "}
              ({lastAction.previousStock} → {lastAction.newStock})
            </p>
          </div>
          <button
            onClick={handleUndo}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-700 text-white font-bold text-xs transition-colors active:scale-95 shrink-0 shadow-xs"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>{lang === "hi" ? "अनडू करें" : "Undo"}</span>
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

      {/* Owner Add Product Modal */}
      <AddProductModal
        isOpen={isAddProductModalOpen}
        onClose={() => setIsAddProductModalOpen(false)}
        categories={categories}
        existingBrands={dynamicFilterOptions.brands}
        onProductCreated={() => {
          loadInitialData();
          if (isOwner) {
            fetchOwnerCostMap().then(setOwnerCostMap);
          }
        }}
        onSwitchToAdjustStock={(modelNum) => {
          const match = products.find(
            (p) => p.modelNumber.toLowerCase() === modelNum.toLowerCase()
          );
          setAdjustStockState({ isOpen: true, product: match || null });
        }}
      />

      {/* Owner Edit Product Modal */}
      <EditProductModal
        isOpen={editProductState.isOpen}
        onClose={() => setEditProductState({ isOpen: false, product: null })}
        product={editProductState.product}
        currentCost={editProductState.product ? ownerCostMap[editProductState.product.id] : null}
        onProductUpdated={() => {
          loadInitialData();
          if (isOwner) {
            fetchOwnerCostMap().then(setOwnerCostMap);
          }
        }}
      />

      {/* Adjust Stock Modal (Add units from Delivery / Corrections) */}
      <AdjustStockModal
        isOpen={adjustStockState.isOpen}
        onClose={() => setAdjustStockState({ isOpen: false, product: null })}
        products={products}
        initialProduct={adjustStockState.product}
        onStockAdjusted={() => {
          loadInitialData();
        }}
      />

      {/* Mobile Bottom Navigation */}
      <BottomNav activeTab={activeTab} onSelectTab={setActiveTab} />
    </div>
  );
}
