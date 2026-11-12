"use client";

import React, { useState, useEffect } from "react";
import {
  X,
  Plus,
  ShieldCheck,
  AlertTriangle,
  Loader2,
  Lock,
  ArrowRight,
  PackagePlus,
} from "lucide-react";
import { useLanguage } from "@/lib/language-context";
import {
  DbCategory,
  checkModelNumberExists,
  createProductWithVariant,
} from "@/lib/services/inventory-service";

interface AddProductModalProps {
  isOpen: boolean;
  onClose: () => void;
  categories: DbCategory[];
  existingBrands: string[];
  onProductCreated: () => void;
  onSwitchToAdjustStock?: (modelNumber: string) => void;
}

// Category default HSN suggestion (user can edit/change anytime)
const DEFAULT_HSN_BY_CAT: Record<string, string> = {
  "washing-machines": "8450",
  refrigerators: "8418",
  "led-tvs": "8528",
  "air-conditioners": "8415",
  "air-coolers": "8479",
  other: "8450",
};

// Preset spec keys for common showroom categories
const SUGGESTED_SPECS_BY_CAT: Record<
  string,
  { key: string; labelEn: string; labelHi: string; placeholder: string }[]
> = {
  "washing-machines": [
    { key: "Capacity", labelEn: "Capacity", labelHi: "क्षमता", placeholder: "e.g. 8 KG" },
    { key: "Type", labelEn: "Type", labelHi: "प्रकार", placeholder: "e.g. Front Load / Top Load / Semi" },
    { key: "Energy Rating", labelEn: "Star Rating", labelHi: "स्टार रेटिंग", placeholder: "e.g. 5 Star" },
  ],
  refrigerators: [
    { key: "Capacity", labelEn: "Capacity", labelHi: "क्षमता", placeholder: "e.g. 215 L" },
    { key: "Type", labelEn: "Type", labelHi: "प्रकार", placeholder: "e.g. Single Door / Frost Free" },
    { key: "Defrosting", labelEn: "Defrosting", labelHi: "डिफ्रॉस्टिंग", placeholder: "Direct Cool / Frost Free" },
    { key: "Energy Rating", labelEn: "Star Rating", labelHi: "स्टार रेटिंग", placeholder: "e.g. 4 Star" },
  ],
  "led-tvs": [
    { key: "Screen Size", labelEn: "Screen Size", labelHi: "स्क्रीन साइज", placeholder: "e.g. 43 Inch / 55 Inch" },
    { key: "Resolution", labelEn: "Display / Resolution", labelHi: "रिजॉल्यूशन", placeholder: "e.g. 4K Ultra HD" },
  ],
  "air-conditioners": [
    { key: "Tonnage", labelEn: "Tonnage", labelHi: "टन", placeholder: "e.g. 1.5 Ton" },
    { key: "Technology", labelEn: "Compressor", labelHi: "टेक्नोलॉजी", placeholder: "e.g. Inverter" },
    { key: "Energy Rating", labelEn: "Star Rating", labelHi: "स्टार रेटिंग", placeholder: "e.g. 5 Star" },
  ],
  "air-coolers": [
    { key: "Tank", labelEn: "Tank Capacity", labelHi: "टैंक क्षमता", placeholder: "e.g. 70 L" },
    { key: "Type", labelEn: "Cooler Type", labelHi: "कूलर का प्रकार", placeholder: "e.g. Desert Cooler" },
  ],
};

export function AddProductModal({
  isOpen,
  onClose,
  categories,
  existingBrands,
  onProductCreated,
  onSwitchToAdjustStock,
}: AddProductModalProps) {
  const { lang } = useLanguage();
  const isHindi = lang === "hi";

  const [categoryId, setCategoryId] = useState("");
  const [brand, setBrand] = useState("");
  const [name, setName] = useState("");
  const [modelNumber, setModelNumber] = useState("");
  const [hsnCode, setHsnCode] = useState("8450");
  const [variantName, setVariantName] = useState("");

  // Dynamic specs map
  const [specs, setSpecs] = useState<Record<string, string>>({});
  const [customSpecKey, setCustomSpecKey] = useState("");
  const [customSpecValue, setCustomSpecValue] = useState("");

  // Pricing & Stock
  const [mrp, setMrp] = useState<string>("");
  const [sellingPrice, setSellingPrice] = useState<string>("");
  const [purchasePrice, setPurchasePrice] = useState<string>("");
  const [openingStock, setOpeningStock] = useState<string>("1");
  const [lowStockThreshold, setLowStockThreshold] = useState<string>("2");

  // State flags
  const [isCheckingModel, setIsCheckingModel] = useState(false);
  const [modelDuplicate, setModelDuplicate] = useState<{
    exists: boolean;
    variantName?: string;
    variantId?: string;
  } | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // Set default category when categories load
  useEffect(() => {
    if (categories.length > 0 && !categoryId) {
      const defaultCat = categories[0];
      setCategoryId(defaultCat.id);
      setHsnCode(DEFAULT_HSN_BY_CAT[defaultCat.slug] || "8450");
    }
  }, [categories, categoryId]);

  // When category changes, auto-suggest HSN code if user hasn't typed a custom one
  const handleCategoryChange = (newCatId: string) => {
    setCategoryId(newCatId);
    const cat = categories.find((c) => c.id === newCatId);
    if (cat) {
      setHsnCode(DEFAULT_HSN_BY_CAT[cat.slug] || "8450");
    }
  };

  // Check duplicate model number when user leaves the field or pauses
  const handleModelBlur = async () => {
    const clean = modelNumber.trim();
    if (!clean) {
      setModelDuplicate(null);
      return;
    }

    setIsCheckingModel(true);
    try {
      const res = await checkModelNumberExists(clean);
      if (res.exists) {
        setModelDuplicate({
          exists: true,
          variantName: res.variantName,
          variantId: res.variantId,
        });
      } else {
        setModelDuplicate(null);
      }
    } finally {
      setIsCheckingModel(false);
    }
  };

  // Handle adding custom specification key-value
  const handleAddCustomSpec = () => {
    if (!customSpecKey.trim() || !customSpecValue.trim()) return;
    setSpecs((prev) => ({
      ...prev,
      [customSpecKey.trim()]: customSpecValue.trim(),
    }));
    setCustomSpecKey("");
    setCustomSpecValue("");
  };

  const handleRemoveSpec = (keyToRemove: string) => {
    setSpecs((prev) => {
      const copy = { ...prev };
      delete copy[keyToRemove];
      return copy;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!categoryId) {
      setFormError(isHindi ? "कृपया कैटेगरी चुनें" : "Please select a category");
      return;
    }
    if (!brand.trim()) {
      setFormError(isHindi ? "कृपया ब्रांड का नाम लिखें" : "Please enter brand name");
      return;
    }
    if (!name.trim()) {
      setFormError(isHindi ? "कृपया सामान का नाम लिखें" : "Please enter product name");
      return;
    }
    if (!modelNumber.trim()) {
      setFormError(isHindi ? "कृपया मॉडल नंबर लिखें" : "Please enter model number");
      return;
    }
    if (modelDuplicate?.exists) {
      setFormError(
        isHindi
          ? `यह मॉडल नंबर (${modelNumber}) पहले से मौजूद है!`
          : `Model number "${modelNumber}" already exists!`
      );
      return;
    }

    const numSelling = parseFloat(sellingPrice);
    if (isNaN(numSelling) || numSelling <= 0) {
      setFormError(isHindi ? "कृपया सही सेलिंग प्राइस (₹) लिखें" : "Please enter valid selling price");
      return;
    }

    const numMrp = parseFloat(mrp) || numSelling;
    const numPurchase = purchasePrice ? parseFloat(purchasePrice) : null;
    const numStock = parseInt(openingStock, 10) || 0;
    const numThreshold = parseInt(lowStockThreshold, 10) || 2;

    // Default variant subtitle if empty
    const computedVariantName =
      variantName.trim() ||
      specs["Capacity"] ||
      specs["Screen Size"] ||
      specs["Tonnage"] ||
      "Standard Edition";

    setIsSubmitting(true);
    try {
      const res = await createProductWithVariant({
        categoryId,
        brand: brand.trim(),
        name: name.trim(),
        variantName: computedVariantName,
        modelNumber: modelNumber.trim(),
        hsnCode: hsnCode.trim() || "8450",
        attributes: specs,
        mrp: numMrp,
        sellingPrice: numSelling,
        purchasePrice: numPurchase,
        openingStock: numStock,
        lowStockThreshold: numThreshold,
      });

      if (!res.success) {
        if (res.error?.includes("DUPLICATE_MODEL")) {
          setModelDuplicate({ exists: true });
          setFormError(
            isHindi
              ? "यह मॉडल नंबर पहले से किसी आइटम में दर्ज है।"
              : "This model number is already in use by another item."
          );
        } else {
          setFormError(res.error || "Failed to add product");
        }
        return;
      }

      // Success
      onProductCreated();
      onClose();
    } catch (err: any) {
      setFormError(err?.message || "An unexpected error occurred");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  const currentCat = categories.find((c) => c.id === categoryId);
  const suggestedSpecs = currentCat ? SUGGESTED_SPECS_BY_CAT[currentCat.slug] || [] : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-slate-950/70 backdrop-blur-xs overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-6 animate-in fade-in zoom-in-95 duration-150">
        {/* Header */}
        <div className="p-5 bg-gradient-to-r from-amber-500 to-amber-600 text-white flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-white/20 backdrop-blur-xs flex items-center justify-center">
              <PackagePlus className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-black tracking-tight">
                {isHindi ? "नया सामान जोड़ें (Add New Product)" : "Add New Showroom Product"}
              </h2>
              <p className="text-xs text-amber-100 font-medium">
                {isHindi
                  ? "मालिक अधिकार • खरीद रेट गुप्त टेबल में सुरक्षित रहेगा"
                  : "Owner Only • Purchase cost is stored strictly in private product_costs"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/20 hover:bg-white/30 text-white flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit} className="p-6 flex flex-col gap-5 max-h-[75vh] overflow-y-auto">
          {formError && (
            <div className="p-3.5 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-xs font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
              <span>{formError}</span>
            </div>
          )}

          {/* Duplicate Model Number Warning Banner */}
          {modelDuplicate?.exists && (
            <div className="p-4 rounded-2xl bg-amber-50 border-2 border-amber-300 text-amber-950 flex flex-col gap-2.5 animate-in fade-in">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                <div className="text-xs">
                  <p className="font-bold">
                    {isHindi
                      ? `मॉडल "${modelNumber}" पहले से दर्ज है!`
                      : `Model Number "${modelNumber}" already exists in shop inventory!`}
                  </p>
                  <p className="text-amber-800 text-[11px] mt-0.5">
                    {isHindi
                      ? `यह मॉडल "${modelDuplicate.variantName || "सामान"}" के लिए है। डुप्लीकेट बनाने के बजाय क्या आप इसका स्टॉक बढ़ाना चाहते हैं?`
                      : `This model belongs to "${modelDuplicate.variantName || "Item"}". To prevent confusion, add stock to it instead of creating a duplicate.`}
                  </p>
                </div>
              </div>

              {onSwitchToAdjustStock && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onSwitchToAdjustStock(modelNumber);
                  }}
                  className="flex items-center justify-center gap-2 py-2 px-3.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-bold text-xs transition-colors self-start shadow-xs"
                >
                  <span>{isHindi ? "पुराने सामान में स्टॉक बढ़ाएं" : "Add Stock to Existing Item Instead"}</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          )}

          {/* Section 1: Basic Identifiers */}
          <div className="flex flex-col gap-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {isHindi ? "1. बेसिक जानकारी (Category & Model)" : "1. Basic Identification"}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Category */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isHindi ? "कैटेगरी *" : "Category *"}
                </label>
                <select
                  value={categoryId}
                  onChange={(e) => handleCategoryChange(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.icon} {isHindi ? c.nameHi : c.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Brand */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isHindi ? "ब्रांड *" : "Brand *"}
                </label>
                <input
                  type="text"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  list="brand-suggestions"
                  placeholder="e.g. Godrej, LG, Samsung"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
                <datalist id="brand-suggestions">
                  {existingBrands.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </div>
            </div>

            {/* Product Name */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isHindi ? "सामान का पूरा नाम *" : "Product Name *"}
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  isHindi
                    ? "जैसे: Godrej Edge Pro Direct Cool Refrigerator"
                    : "e.g. Godrej Edge Pro Direct Cool Refrigerator"
                }
                className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>

            {/* Model Number & HSN Code */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Unique Model Number */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-slate-700">
                    {isHindi ? "मॉडल नंबर (Unique) *" : "Model Number (Unique) *"}
                  </label>
                  {isCheckingModel && (
                    <span className="text-[10px] text-amber-600 flex items-center gap-1 font-semibold">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      {isHindi ? "जाँच रहे हैं..." : "Checking..."}
                    </span>
                  )}
                </div>
                <input
                  type="text"
                  value={modelNumber}
                  onChange={(e) => {
                    setModelNumber(e.target.value.toUpperCase());
                    setModelDuplicate(null);
                  }}
                  onBlur={handleModelBlur}
                  placeholder="e.g. RD-EDGE-205"
                  className={`w-full px-3 py-2.5 rounded-xl font-mono uppercase text-xs font-bold text-slate-900 border focus:bg-white focus:outline-hidden focus:ring-2 ${
                    modelDuplicate?.exists
                      ? "bg-amber-50 border-amber-400 focus:ring-amber-500 text-amber-950"
                      : "bg-slate-50 border-slate-200 focus:ring-amber-500"
                  }`}
                />
              </div>

              {/* HSN Code (Tax Category) */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isHindi ? "HSN कोड (टैक्स ग्रुप) *" : "HSN Code (Tax Group) *"}
                </label>
                <input
                  type="text"
                  value={hsnCode}
                  onChange={(e) => setHsnCode(e.target.value)}
                  placeholder="e.g. 8450, 8418, 8528"
                  className="w-full px-3 py-2.5 rounded-xl font-mono text-xs font-bold text-slate-900 bg-slate-50 border border-slate-200 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
                <span className="text-[10px] text-slate-400 mt-0.5 block">
                  {isHindi ? "GST बिल वाला कोड। इसे बदल सकते हैं।" : "GST Tax Code. Editable anytime."}
                </span>
              </div>
            </div>

            {/* Variant / Subtitle */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                {isHindi ? "वेरिएंट / सब-टाइटल (वैकल्पिक)" : "Variant / Subtitle (Optional)"}
              </label>
              <input
                type="text"
                value={variantName}
                onChange={(e) => setVariantName(e.target.value)}
                placeholder="e.g. 8 KG Front Load (Silver Steel)"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
              />
            </div>
          </div>

          {/* Section 2: Specifications (Size, Feature, Rating) */}
          <div className="flex flex-col gap-3 border-t border-slate-100 pt-3">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                {isHindi ? "2. स्पेसिफिकेशन व साइज" : "2. Specifications & Dimensions"}
              </h3>
              <span className="text-[11px] text-slate-400">
                {isHindi ? "सॉर्टिंग और फ़िल्टर के लिए जरूरी" : "Used for sorting & filter chips"}
              </span>
            </div>

            {/* Suggested Specs for this Category */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {suggestedSpecs.map((s) => (
                <div key={s.key}>
                  <label className="block text-xs font-bold text-slate-700 mb-1">
                    {isHindi ? s.labelHi : s.labelEn}
                  </label>
                  <input
                    type="text"
                    value={specs[s.key] || ""}
                    onChange={(e) =>
                      setSpecs((prev) => ({
                        ...prev,
                        [s.key]: e.target.value,
                      }))
                    }
                    placeholder={s.placeholder}
                    className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                  />
                </div>
              ))}
            </div>

            {/* Active Custom Specs Badges */}
            {Object.keys(specs).length > 0 && (
              <div className="flex flex-wrap gap-1.5 mt-1">
                {Object.entries(specs).map(([k, v]) => {
                  if (!v) return null;
                  return (
                    <span
                      key={k}
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100 border border-slate-200 text-slate-800 text-[11px] font-semibold"
                    >
                      <strong>{k}:</strong> {v}
                      <button
                        type="button"
                        onClick={() => handleRemoveSpec(k)}
                        className="text-slate-400 hover:text-red-600 ml-0.5"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            {/* Add Custom Spec Row */}
            <div className="flex items-center gap-2 mt-1">
              <input
                type="text"
                value={customSpecKey}
                onChange={(e) => setCustomSpecKey(e.target.value)}
                placeholder={isHindi ? "नया फीचर (जैसे: Motor)" : "New spec key (e.g. Color)"}
                className="w-1/3 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-900"
              />
              <input
                type="text"
                value={customSpecValue}
                onChange={(e) => setCustomSpecValue(e.target.value)}
                placeholder={isHindi ? "वैल्यू (जैसे: Inverter)" : "Value (e.g. Grey)"}
                className="w-1/2 px-3 py-1.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-medium text-slate-900"
              />
              <button
                type="button"
                onClick={handleAddCustomSpec}
                className="px-3 py-1.5 rounded-xl bg-slate-200 hover:bg-slate-300 text-slate-800 text-xs font-bold flex items-center gap-1 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isHindi ? "जोड़ें" : "Add"}</span>
              </button>
            </div>
          </div>

          {/* Section 3: Pricing & Inventory */}
          <div className="flex flex-col gap-3 border-t border-slate-100 pt-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {isHindi ? "3. रेट और स्टॉक" : "3. Pricing & Inventory"}
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Selling Price (Showroom Customer Price) */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  {isHindi ? "सेलिंग प्राइस (₹) *" : "Selling Price (₹) *"}
                </label>
                <input
                  type="number"
                  value={sellingPrice}
                  onChange={(e) => setSellingPrice(e.target.value)}
                  placeholder="e.g. 28990"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-sm font-black text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* MRP */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isHindi ? "MRP (काटा हुआ रेट)" : "MRP (M.R.P.)"}
                </label>
                <input
                  type="number"
                  value={mrp}
                  onChange={(e) => setMrp(e.target.value)}
                  placeholder="e.g. 34990"
                  className="w-full px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-700 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Purchase Cost (Confidential) */}
              <div>
                <div className="flex items-center gap-1 mb-1">
                  <Lock className="w-3 h-3 text-amber-600" />
                  <label className="text-xs font-bold text-amber-900">
                    {isHindi ? "खरीद रेट (Private) *" : "Purchase Cost (Private)"}
                  </label>
                </div>
                <input
                  type="number"
                  value={purchasePrice}
                  onChange={(e) => setPurchasePrice(e.target.value)}
                  placeholder="e.g. 23500"
                  className="w-full px-3 py-2.5 rounded-xl bg-amber-50/70 border border-amber-300 text-xs font-bold text-amber-950 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
                <span className="text-[10px] text-amber-700 block mt-0.5 font-medium">
                  {isHindi ? "केवल मालिक देख सकता है" : "Owner only cost"}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Opening Stock */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isHindi ? "शुरुआती स्टॉक (पीस) *" : "Opening Stock (Units) *"}
                </label>
                <input
                  type="number"
                  value={openingStock}
                  onChange={(e) => setOpeningStock(e.target.value)}
                  min="0"
                  placeholder="1"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>

              {/* Low Stock Threshold */}
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  {isHindi ? "कम स्टॉक चेतावनी (पीस)" : "Low Stock Alert Level"}
                </label>
                <input
                  type="number"
                  value={lowStockThreshold}
                  onChange={(e) => setLowStockThreshold(e.target.value)}
                  min="1"
                  placeholder="2"
                  className="w-full px-3 py-2 rounded-xl bg-slate-50 border border-slate-200 text-xs font-bold text-slate-900 focus:bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                />
              </div>
            </div>
          </div>

          {/* Form Actions */}
          <div className="flex items-center justify-end gap-2.5 border-t border-slate-100 pt-4 mt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-5 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold transition-colors"
            >
              {isHindi ? "रद्द करें" : "Cancel"}
            </button>

            <button
              type="submit"
              disabled={isSubmitting || !!modelDuplicate?.exists}
              className={`flex items-center gap-2 px-6 py-2.5 rounded-xl text-white text-xs font-bold transition-all active:scale-95 shadow-md ${
                isSubmitting || !!modelDuplicate?.exists
                  ? "bg-slate-300 text-slate-500 cursor-not-allowed shadow-none"
                  : "bg-amber-600 hover:bg-amber-700 shadow-amber-600/25"
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>{isHindi ? "सेव हो रहा है..." : "Saving..."}</span>
                </>
              ) : (
                <>
                  <ShieldCheck className="w-4 h-4" />
                  <span>{isHindi ? "सामान सेव करें" : "Save Product"}</span>
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
