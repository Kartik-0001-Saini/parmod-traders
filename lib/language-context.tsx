"use client";

import React, { createContext, useContext, useState, useEffect } from "react";

/**
 * BEGINNER LESSON: React Context
 * Context lets us share state (like the current language) across all components
 * without having to pass props down manually through every layer ("prop drilling").
 */

export type Language = "en" | "hi";

export interface Translations {
  // Brand & Header
  appName: string;
  appTagline: string;
  modeCheck: string;
  modeCheckSub: string;
  modeUpdate: string;
  modeUpdateSub: string;
  enterPin: string;
  pinPlaceholder: string;
  unlock: string;
  cancel: string;
  wrongPin: string;

  // Search & Navigation
  searchPlaceholder: string;
  navHome: string;
  navCatalog: string;
  navHistory: string;
  navSettings: string;

  // Home 4 Big Action Buttons
  actionSoldTitle: string;
  actionSoldDesc: string;
  actionAddStockTitle: string;
  actionAddStockDesc: string;
  actionBillTitle: string;
  actionBillDesc: string;
  actionSearchTitle: string;
  actionSearchDesc: string;

  // Stock Status Labels
  inStock: string;
  lowStock: string;
  outOfStock: string;
  verifyWarning: string;
  sellingPrice: string;
  mrp: string;
  saveRupees: string;

  // Stock Action Buttons
  soldOneBtn: string;
  returnOneBtn: string;
  confirmTitle: string;
  confirmDesc: string;
  confirmYes: string;
  undoToast: string;
  undoBtn: string;

  // Categories
  allCategories: string;
  catWashingMachines: string;
  catRefrigerators: string;
  catAirConditioners: string;
  catLedTvs: string;
  catAirCoolers: string;
  catOther: string;

  // Helpful hints
  quickNotice: string;
  showingItems: string;
}

const translations: Record<Language, Translations> = {
  en: {
    appName: "Parmod Traders",
    appTagline: "Electronics Showroom Inventory",
    modeCheck: "Check Mode",
    modeCheckSub: "Safe to view prices & stock",
    modeUpdate: "Update Mode",
    modeUpdateSub: "PIN protected: Stock & price edits",
    enterPin: "Enter Owner PIN",
    pinPlaceholder: "Enter 4-digit PIN",
    unlock: "Unlock",
    cancel: "Cancel",
    wrongPin: "Incorrect PIN. Try 1234",

    searchPlaceholder: "Search item name, brand, or model no...",
    navHome: "Home",
    navCatalog: "Items in Shop",
    navHistory: "History",
    navSettings: "Settings",

    actionSoldTitle: "Sold an Item",
    actionSoldDesc: "Mark 1 item as sold instantly",
    actionAddStockTitle: "Add Stock",
    actionAddStockDesc: "Add new items received",
    actionBillTitle: "Upload Bill",
    actionBillDesc: "Scan supplier purchase bill",
    actionSearchTitle: "Search Products",
    actionSearchDesc: "Quick check prices & stock",

    inStock: "In Shop",
    lowStock: "Low Stock",
    outOfStock: "Out of Stock",
    verifyWarning: "Please verify stock (7+ days)",
    sellingPrice: "Selling Price",
    mrp: "MRP",
    saveRupees: "Save",

    soldOneBtn: "Sold 1",
    returnOneBtn: "Return +1",
    confirmTitle: "Confirm Stock Change",
    confirmDesc: "Stock will change. Is this correct?",
    confirmYes: "Yes, Update",
    undoToast: "Stock updated!",
    undoBtn: "Undo",

    allCategories: "All Items",
    catWashingMachines: "Washing Machines",
    catRefrigerators: "Refrigerators",
    catAirConditioners: "Air Conditioners",
    catLedTvs: "LED TVs",
    catAirCoolers: "Air Coolers",
    catOther: "Other Items",

    quickNotice: "Tap 'Sold 1' when a customer buys an item. Stock updates safely.",
    showingItems: "Items found",
  },
  hi: {
    appName: "प्रमोद ट्रेडर्स",
    appTagline: "इलेक्ट्रॉनिक्स शोरूम स्टॉक",
    modeCheck: "देखने का मोड",
    modeCheckSub: "रेट और स्टॉक सुरक्षित देखें",
    modeUpdate: "बदलाव मोड",
    modeUpdateSub: "पिन से सुरक्षित: बदलाव की अनुमति",
    enterPin: "मालिक का पिन दर्ज करें",
    pinPlaceholder: "4 अंकों का पिन डालें",
    unlock: "अनलॉक करें",
    cancel: "रद्द करें",
    wrongPin: "गलत पिन है। 1234 आज़माएँ",

    searchPlaceholder: "सामान, ब्रांड या मॉडल नंबर खोजें...",
    navHome: "होम",
    navCatalog: "दुकान का सामान",
    navHistory: "लेन-देन का इतिहास",
    navSettings: "सेटिंग्स",

    actionSoldTitle: "सामान बिका",
    actionSoldDesc: "1 सामान बिकने पर तुरंत घटाएं",
    actionAddStockTitle: "नया सामान आया",
    actionAddStockDesc: "नई पेटी या स्टॉक जोड़ें",
    actionBillTitle: "बिल स्कैन करें",
    actionBillDesc: "खरीद बिल की फोटो खींचें",
    actionSearchTitle: "सामान खोजें",
    actionSearchDesc: "रेट और स्टॉक तुरंत देखें",

    inStock: "दुकान में उपलब्ध",
    lowStock: "कम बचा है",
    outOfStock: "खत्म हो गया",
    verifyWarning: "स्टॉक की दोबारा जांच करें (7+ दिन)",
    sellingPrice: "बिक्री रेट",
    mrp: "एमआरपी",
    saveRupees: "बचत",

    soldOneBtn: "1 बिका (-1)",
    returnOneBtn: "वापसी (+1)",
    confirmTitle: "स्टॉक बदलने की पुष्टि",
    confirmDesc: "स्टॉक की संख्या बदलेगी। क्या यह सही है?",
    confirmYes: "हाँ, बदलें",
    undoToast: "स्टॉक बदल दिया गया!",
    undoBtn: "वापस पहले जैसा करें (Undo)",

    allCategories: "सभी सामान",
    catWashingMachines: "वॉशिंग मशीन",
    catRefrigerators: "फ्रिज",
    catAirConditioners: "एसी (AC)",
    catLedTvs: "एलईडी टीवी",
    catAirCoolers: "कूलर",
    catOther: "अन्य सामान",

    quickNotice: "जब ग्राहक सामान ले जाए तो '1 बिका' दबाएं। स्टॉक सुरक्षित अपडेट होगा।",
    showingItems: "सामान मिले",
  },
};

interface LanguageContextType {
  lang: Language;
  setLang: (lang: Language) => void;
  toggleLang: () => void;
  t: Translations;
}

const LanguageContext = createContext<LanguageContextType | undefined>(undefined);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [lang, setLangState] = useState<Language>("en");

  // Load language preference from local storage if available
  useEffect(() => {
    try {
      const saved = localStorage.getItem("parmod_lang") as Language;
      if (saved === "en" || saved === "hi") {
        setLangState(saved);
      }
    } catch {
      // LocalStorage access might fail in strict environments; ignore safely
    }
  }, []);

  const setLang = (newLang: Language) => {
    setLangState(newLang);
    try {
      localStorage.setItem("parmod_lang", newLang);
    } catch {
      // ignore
    }
  };

  const toggleLang = () => {
    setLang(lang === "en" ? "hi" : "en");
  };

  const value = {
    lang,
    setLang,
    toggleLang,
    t: translations[lang],
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error("useLanguage must be used within a LanguageProvider");
  }
  return context;
}
