import { getSupabaseBrowserClient } from "@/lib/supabase/client";

export interface BillPage {
  page_number: number;
  file_url: string;
  file_hash: string;
}

export interface BillRecord {
  id: string;
  supplier_name: string;
  supplier_gstin: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  total_amount: number | null;
  subtotal_excl_tax: number | null;
  cgst_amount: number | null;
  sgst_amount: number | null;
  igst_amount: number | null;
  total_pieces: number | null;
  file_url: string;
  file_hash: string;
  pages: BillPage[];
  page_count: number;
  has_continuation_warning: boolean;
  irn: string | null;
  pricing_basis: "incl_tax" | "excl_tax";
  status: "uploaded" | "extracted" | "checked" | "verified" | "confirmed" | "rejected";
  extracted_data: any | null;
  confirmed_at: string | null;
  confirmed_by: string | null;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadMultiPageBillParams {
  files: File[];
  supplierName?: string;
  supplierGstin?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  irn?: string;
  totalAmount?: number;
  pricingBasis?: "incl_tax" | "excl_tax";
}

/**
 * Computes SHA-256 hash of a file in the browser using the Web Crypto API.
 * Runs in < 50ms and prevents uploading duplicate files.
 */
export async function computeFileHash(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const hashBuffer = await crypto.subtle.digest("SHA-256", buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 3-Tier Duplicate Check:
 * Priority 1: E-invoice IRN (if present)
 * Priority 2: Supplier GSTIN + Invoice Number (if both present)
 * Priority 3: File SHA-256 Hash
 */
export async function checkDuplicateBill(params: {
  fileHashes: string[];
  irn?: string;
  supplierGstin?: string;
  invoiceNumber?: string;
}): Promise<{
  isDuplicate: boolean;
  duplicateType?: "irn" | "invoice" | "hash";
  existingBill?: Partial<BillRecord>;
  message?: string;
}> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { isDuplicate: false };
  }

  try {
    // 1. Priority 1: E-Invoice IRN Check
    if (params.irn && params.irn.trim()) {
      const cleanIrn = params.irn.trim();
      const { data: irnMatch } = await supabase
        .from("bills")
        .select("id, supplier_name, invoice_number, invoice_date, status, created_at, irn")
        .eq("irn", cleanIrn)
        .maybeSingle();

      if (irnMatch) {
        return {
          isDuplicate: true,
          duplicateType: "irn",
          existingBill: irnMatch as Partial<BillRecord>,
          message: `ई-इनवॉइस IRN पहले से सिस्टम में दर्ज है (${irnMatch.supplier_name || "Supplier"}, बिल: ${irnMatch.invoice_number || ""})। Duplicate IRN detected.`,
        };
      }
    }

    // 2. Priority 2: Supplier GSTIN + Invoice Number Check
    if (
      params.supplierGstin &&
      params.supplierGstin.trim() &&
      params.invoiceNumber &&
      params.invoiceNumber.trim()
    ) {
      const { data: invMatch } = await supabase
        .from("bills")
        .select("id, supplier_name, supplier_gstin, invoice_number, invoice_date, status, created_at")
        .ilike("supplier_gstin", params.supplierGstin.trim())
        .ilike("invoice_number", params.invoiceNumber.trim())
        .maybeSingle();

      if (invMatch) {
        return {
          isDuplicate: true,
          duplicateType: "invoice",
          existingBill: invMatch as Partial<BillRecord>,
          message: `सप्लायर GSTIN "${params.supplierGstin.trim()}" और इनवॉइस नंबर "${params.invoiceNumber.trim()}" का बिल पहले से दर्ज है। Duplicate invoice detected.`,
        };
      }
    }

    // 3. Priority 3: File SHA-256 Hash Check (checks all pages)
    for (const hash of params.fileHashes) {
      if (!hash) continue;
      const { data: hashMatch } = await supabase
        .from("bills")
        .select("id, supplier_name, invoice_number, invoice_date, status, created_at, file_hash")
        .eq("file_hash", hash)
        .maybeSingle();

      if (hashMatch) {
        const uploadDate = new Date(hashMatch.created_at).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
        return {
          isDuplicate: true,
          duplicateType: "hash",
          existingBill: hashMatch as Partial<BillRecord>,
          message: `यह पर्ची पहले ही अपलोड की जा चुकी है (${hashMatch.supplier_name || "Supplier"}, दिनांक: ${uploadDate})। Duplicate bill file detected.`,
        };
      }
    }

    return { isDuplicate: false };
  } catch (err: any) {
    console.error("Duplicate check error:", err);
    return { isDuplicate: false };
  }
}

/**
 * Uploads a multi-page bill (several photos or multi-page PDF) to private Supabase Storage
 * and creates a tracking record in 'public.bills'.
 *
 * SAFETY RULE: Generates unique UUID file paths (never puts invoice numbers or slashes in storage paths).
 */
export async function uploadMultiPageBill(params: UploadMultiPageBillParams): Promise<{
  success: boolean;
  bill?: BillRecord;
  error?: string;
}> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { success: false, error: "Database not connected. Please check configuration." };
  }

  const files = params.files || [];
  if (files.length === 0) {
    return { success: false, error: "No files selected. कृपया कम से कम एक पेज या फोटो चुनें।" };
  }

  // File size and type validations
  const MAX_BYTES = 10 * 1024 * 1024; // 10MB per page
  const allowedMime = ["image/jpeg", "image/jpg", "image/png", "application/pdf"];

  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (f.size > MAX_BYTES) {
      return {
        success: false,
        error: `Page ${i + 1} exceeds 10MB limit. कृपया 10MB से छोटी फाइल चुनें।`,
      };
    }
    if (!allowedMime.includes(f.type)) {
      return {
        success: false,
        error: `Page ${i + 1} is not a valid format. केवल PDF, JPG या PNG फाइल अपलोड करें।`,
      };
    }
  }

  try {
    // 1. Compute Hashes for all pages
    const fileHashes: string[] = [];
    for (const f of files) {
      const h = await computeFileHash(f);
      fileHashes.push(h);
    }

    // 2. 3-Tier Duplicate Check
    const dupCheck = await checkDuplicateBill({
      fileHashes,
      irn: params.irn,
      supplierGstin: params.supplierGstin,
      invoiceNumber: params.invoiceNumber,
    });

    if (dupCheck.isDuplicate) {
      return {
        success: false,
        error: dupCheck.message || "Duplicate bill detected",
      };
    }

    // 3. Upload Each File to Private Storage using Unique UUIDs
    // Never use invoice numbers with slashes in storage paths!
    const billFolderUuid = typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `bill_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;

    const uploadedPages: BillPage[] = [];

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const ext = file.name.split(".").pop()?.toLowerCase() || (file.type === "application/pdf" ? "pdf" : "jpg");
      const storagePath = `${billFolderUuid}/page_${i + 1}_${Date.now()}.${ext}`;

      const { data: uploadData, error: uploadErr } = await supabase.storage
        .from("bills")
        .upload(storagePath, file, {
          contentType: file.type,
          upsert: false,
        });

      if (uploadErr) {
        console.error("Storage upload error on page", i + 1, uploadErr);
        // Rollback already uploaded pages
        if (uploadedPages.length > 0) {
          await supabase.storage.from("bills").remove(uploadedPages.map((p) => p.file_url));
        }
        return {
          success: false,
          error: `Storage upload failed on page ${i + 1}: ${uploadErr.message}. Make sure private 'bills' bucket exists.`,
        };
      }

      uploadedPages.push({
        page_number: i + 1,
        file_url: uploadData.path,
        file_hash: fileHashes[i],
      });
    }

    // 4. Insert Row into 'public.bills' table
    const defaultSupplierName = params.supplierName?.trim() || "Pending AI Extraction";
    const primaryFileUrl = uploadedPages[0]?.file_url || "";
    const primaryFileHash = fileHashes[0] || "";

    const { data: billData, error: dbError } = await supabase
      .from("bills")
      .insert({
        supplier_name: defaultSupplierName,
        supplier_gstin: params.supplierGstin?.trim() || null,
        invoice_number: params.invoiceNumber?.trim() || null,
        invoice_date: params.invoiceDate || new Date().toISOString().split("T")[0],
        total_amount: params.totalAmount ? Number(params.totalAmount) : null,
        file_url: primaryFileUrl,
        file_hash: primaryFileHash,
        pages: uploadedPages as any,
        page_count: uploadedPages.length,
        irn: params.irn?.trim() || null,
        pricing_basis: params.pricingBasis || "incl_tax",
        status: "uploaded",
      })
      .select()
      .single();

    if (dbError) {
      console.error("Database insert error:", dbError);
      // Clean up uploaded files if DB insert failed
      await supabase.storage.from("bills").remove(uploadedPages.map((p) => p.file_url));
      return {
        success: false,
        error: `Failed to save bill record: ${dbError.message}`,
      };
    }

    return {
      success: true,
      bill: billData as unknown as BillRecord,
    };
  } catch (err: any) {
    console.error("Exception in uploadMultiPageBill:", err);
    return {
      success: false,
      error: err?.message || "An unexpected error occurred during bill upload",
    };
  }
}

/**
 * Fetches recent bills for the Owner view.
 */
export async function fetchBillsList(): Promise<{
  bills: BillRecord[];
  error?: string;
}> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { bills: [], error: "Database not connected" };
  }

  try {
    const { data, error } = await supabase
      .from("bills")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      return { bills: [], error: error.message };
    }

    return { bills: (data || []) as unknown as BillRecord[] };
  } catch (err: any) {
    return { bills: [], error: err?.message || "Failed to load bills" };
  }
}

/**
 * Generates a temporary signed URL for viewing a private bill file (valid for 60 min).
 */
export async function getBillSignedUrl(filePath: string): Promise<{
  signedUrl?: string;
  error?: string;
}> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { error: "Database not connected" };
  }

  try {
    const { data, error } = await supabase.storage
      .from("bills")
      .createSignedUrl(filePath, 3600);

    if (error) {
      return { error: error.message };
    }

    return { signedUrl: data.signedUrl };
  } catch (err: any) {
    return { error: err?.message || "Failed to generate file preview URL" };
  }
}

/**
 * Generates signed URLs for all pages in a multi-page bill.
 */
export async function getBillSignedUrlsForPages(
  pages: BillPage[]
): Promise<{ signedUrls: { page_number: number; url: string }[]; error?: string }> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { signedUrls: [], error: "Database not connected" };
  }

  try {
    const results: { page_number: number; url: string }[] = [];
    for (const page of pages) {
      const { data, error } = await supabase.storage
        .from("bills")
        .createSignedUrl(page.file_url, 3600);

      if (!error && data?.signedUrl) {
        results.push({
          page_number: page.page_number,
          url: data.signedUrl,
        });
      }
    }

    return { signedUrls: results };
  } catch (err: any) {
    return { signedUrls: [], error: err?.message || "Failed to generate page URLs" };
  }
}

/**
 * Allows deleting a bill that is not yet in stock (uploaded, read, or rejected) and its storage files.
 */
export async function deleteBillRecord(
  billId: string,
  pages: BillPage[] | string
): Promise<{ success: boolean; error?: string }> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { success: false, error: "Database not connected" };
  }

  try {
    // 1. Delete row from table
    const { error: dbError } = await supabase
      .from("bills")
      .delete()
      .eq("id", billId)
      .neq("status", "confirmed");

    if (dbError) {
      return { success: false, error: dbError.message };
    }

    // 2. Remove files from storage
    const filePathsToDelete: string[] = [];
    if (Array.isArray(pages)) {
      filePathsToDelete.push(...pages.map((p) => p.file_url));
    } else if (typeof pages === "string") {
      filePathsToDelete.push(pages);
    }

    if (filePathsToDelete.length > 0) {
      await supabase.storage.from("bills").remove(filePathsToDelete);
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || "Failed to delete bill" };
  }
}

/**
 * Fetches known registered suppliers/distributors from the database.
 */
export async function fetchSuppliersList(): Promise<{
  suppliers: { id: string; name: string; gstin: string | null }[];
  error?: string;
}> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase) {
    return { suppliers: [] };
  }

  try {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id, name, gstin")
      .order("name", { ascending: true });

    if (error) return { suppliers: [], error: error.message };
    return { suppliers: data || [] };
  } catch (err: any) {
    return { suppliers: [], error: err?.message };
  }
}

/**
 * Look up remembered variant mapping from Supplier Item Memory.
 */
export async function lookupSupplierAlias(
  supplierGstin: string,
  rawDescription: string
): Promise<{ variantId?: string; error?: string }> {
  const supabase = getSupabaseBrowserClient();
  if (!supabase || !supplierGstin || !rawDescription) {
    return {};
  }

  const cleanDescription = rawDescription.trim().toLowerCase().replace(/\s+/g, " ");

  try {
    const { data, error } = await supabase
      .from("supplier_item_aliases")
      .select("variant_id")
      .eq("supplier_gstin", supplierGstin.trim())
      .eq("clean_description", cleanDescription)
      .maybeSingle();

    if (error || !data) return {};
    return { variantId: data.variant_id };
  } catch {
    return {};
  }
}
