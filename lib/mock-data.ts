export interface ProductItem {
  id: string;
  name: string; // e.g., "Godrej Front Load Washing Machine"
  brand: string; // e.g., "Godrej"
  category: "washing-machines" | "refrigerators" | "air-conditioners" | "led-tvs" | "air-coolers" | "other";
  categoryNameEn: string;
  categoryNameHi: string;
  variant: string; // e.g., "8 KG Fully Automatic / Inverter"
  modelNumber: string; // e.g., "WTEON-800-AD" (crucial for electronics showrooms)
  hsnCode: string; // e.g., "8450" (tax category code)
  currentStock: number;
  lowStockThreshold: number; // Configurable per product (e.g. 2)
  sellingPrice: number; // e.g. 24990
  mrp: number; // e.g. 31990
  lastVerifiedDate: string; // ISO date string
  imageUrl?: string;
  specifications: Record<string, string>;
}

export const INITIAL_PRODUCTS: ProductItem[] = [
  {
    id: "prod-1",
    name: "Godrej Front Load Washing Machine",
    brand: "Godrej",
    category: "washing-machines",
    categoryNameEn: "Washing Machines",
    categoryNameHi: "वॉशिंग मशीन",
    variant: "8 KG Front Load / 5 Star Inverter",
    modelNumber: "WTEON-800-AD",
    hsnCode: "8450",
    currentStock: 4,
    lowStockThreshold: 2,
    sellingPrice: 28990,
    mrp: 35990,
    lastVerifiedDate: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
    specifications: {
      Capacity: "8 KG",
      Type: "Front Load",
      "Energy Rating": "5 Star",
    },
  },
  {
    id: "prod-2",
    name: "LG Double Door Refrigerator",
    brand: "LG",
    category: "refrigerators",
    categoryNameEn: "Refrigerators",
    categoryNameHi: "फ्रिज",
    variant: "260 Litres Smart Inverter / Shiny Steel",
    modelNumber: "GL-S292RDSY",
    hsnCode: "8418",
    currentStock: 2, // Low stock!
    lowStockThreshold: 2,
    sellingPrice: 26490,
    mrp: 31890,
    lastVerifiedDate: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
    specifications: {
      Capacity: "260 L",
      Defrosting: "Frost Free",
      Doors: "Double Door",
    },
  },
  {
    id: "prod-3",
    name: "Voltas Inverter Split AC",
    brand: "Voltas",
    category: "air-conditioners",
    categoryNameEn: "Air Conditioners",
    categoryNameHi: "एसी (AC)",
    variant: "1.5 Ton 3 Star Copper Condenser",
    modelNumber: "183V-Vectra-Plat",
    hsnCode: "8415",
    currentStock: 0, // Out of stock!
    lowStockThreshold: 1,
    sellingPrice: 32990,
    mrp: 62990,
    lastVerifiedDate: new Date(Date.now() - 9 * 24 * 60 * 60 * 1000).toISOString(), // 9 days ago (Needs verify!)
    specifications: {
      Tonnage: "1.5 Ton",
      "Star Rating": "3 Star",
      Condenser: "100% Copper",
    },
  },
  {
    id: "prod-4",
    name: "Samsung Crystal 4K UHD Smart TV",
    brand: "Samsung",
    category: "led-tvs",
    categoryNameEn: "LED TVs",
    categoryNameHi: "एलईडी टीवी",
    variant: "55 Inch Ultra HD (4K) Smart LED",
    modelNumber: "UA55AUE60AKXXL",
    hsnCode: "8528",
    currentStock: 6,
    lowStockThreshold: 2,
    sellingPrice: 42990,
    mrp: 64900,
    lastVerifiedDate: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString(), // 8 days ago (Needs verify!)
    specifications: {
      Screen: "55 Inch",
      Resolution: "4K UHD (3840 x 2160)",
      OS: "Tizen Smart TV",
    },
  },
  {
    id: "prod-5",
    name: "Symphony Diet Desert Air Cooler",
    brand: "Symphony",
    category: "air-coolers",
    categoryNameEn: "Air Coolers",
    categoryNameHi: "कूलर",
    variant: "35 Litre Personal Tower Cooler with i-Pure",
    modelNumber: "DIET-3D-30i",
    hsnCode: "8479",
    currentStock: 5,
    lowStockThreshold: 2,
    sellingPrice: 8490,
    mrp: 10499,
    lastVerifiedDate: new Date().toISOString(), // Today
    specifications: {
      Tank: "35 Litres",
      CoolingPad: "Honeycomb",
    },
  },
  {
    id: "prod-6",
    name: "Bajaj Popular Plus Mixer Grinder",
    brand: "Bajaj",
    category: "other",
    categoryNameEn: "Other Electronics",
    categoryNameHi: "अन्य सामान",
    variant: "500 Watt with 3 Stainless Steel Jars",
    modelNumber: "GX-1-POPLR",
    hsnCode: "8509",
    currentStock: 1, // Low stock
    lowStockThreshold: 2,
    sellingPrice: 1999,
    mrp: 3200,
    lastVerifiedDate: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
    specifications: {
      Wattage: "500 W",
      Jars: "3 Stainless Steel",
    },
  },
];

export interface InventoryMovementRecord {
  id: string;
  productId: string;
  productName: string;
  variant: string;
  modelNumber: string;
  type: "sale" | "return" | "add_stock" | "correction" | "undo";
  quantityChange: number; // -1 for sale, +1 for return
  previousStock: number;
  newStock: number;
  reason: string;
  timestamp: string;
  performedBy: string;
  isUndone?: boolean;
  originalMovementId?: string;
}
