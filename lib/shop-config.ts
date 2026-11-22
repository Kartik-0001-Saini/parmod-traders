/**
 * The shop's own details, printed on every purchase bill as the buyer.
 * The bill reader uses the GSTIN so it never mistakes the shop for the supplier.
 * Override with NEXT_PUBLIC_SHOP_GSTIN if the shop's GSTIN changes.
 */
export const SHOP_NAME = "PARMOD TRADERS LOHARU";
export const SHOP_GSTIN = (process.env.NEXT_PUBLIC_SHOP_GSTIN || "06BTGPM6651M1Z7").toUpperCase();
