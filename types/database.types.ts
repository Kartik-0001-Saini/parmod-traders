export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type UserRole = "owner" | "staff";

export interface Database {
  public: {
    Views: {
      [_ in never]: never;
    };
    Tables: {
      profiles: {
        Relationships: [];
        Row: {
          id: string;
          email: string | null;
          role: UserRole;
          full_name: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          email?: string | null;
          role?: UserRole;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          email?: string | null;
          role?: UserRole;
          full_name?: string | null;
          created_at?: string;
          updated_at?: string;
        };
      };
      categories: {
        Relationships: [];
        Row: {
          id: string;
          name: string;
          name_hi: string;
          slug: string;
          icon: string;
          display_order: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          name: string;
          name_hi: string;
          slug: string;
          icon?: string;
          display_order?: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          name?: string;
          name_hi?: string;
          slug?: string;
          icon?: string;
          display_order?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      category_attributes: {
        Relationships: [];
        Row: {
          id: string;
          category_id: string;
          name: string;
          name_hi: string;
          attribute_type: string;
          options: Json | null;
          is_required: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          category_id: string;
          name: string;
          name_hi: string;
          attribute_type?: string;
          options?: Json | null;
          is_required?: boolean;
          created_at?: string;
        };
        Update: {
          id?: string;
          category_id?: string;
          name?: string;
          name_hi?: string;
          attribute_type?: string;
          options?: Json | null;
          is_required?: boolean;
          created_at?: string;
        };
      };
      products: {
        Relationships: [];
        Row: {
          id: string;
          category_id: string;
          brand: string;
          name: string;
          description: string | null;
          image_url: string | null;
          is_active: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          category_id: string;
          brand: string;
          name: string;
          description?: string | null;
          image_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          category_id?: string;
          brand?: string;
          name?: string;
          description?: string | null;
          image_url?: string | null;
          is_active?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      product_variants: {
        Relationships: [];
        Row: {
          id: string;
          product_id: string;
          variant_name: string;
          model_number: string;
          barcode: string | null;
          attributes: Record<string, string>;
          current_stock: number;
          low_stock_threshold: number;
          selling_price: number;
          mrp: number;
          last_verified_at: string;
          is_active: boolean;
          is_test_seed: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          product_id: string;
          variant_name: string;
          model_number: string;
          barcode?: string | null;
          attributes?: Record<string, string>;
          current_stock?: number;
          low_stock_threshold?: number;
          selling_price: number;
          mrp: number;
          last_verified_at?: string;
          is_active?: boolean;
          is_test_seed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          product_id?: string;
          variant_name?: string;
          model_number?: string;
          barcode?: string | null;
          attributes?: Record<string, string>;
          current_stock?: number;
          low_stock_threshold?: number;
          selling_price?: number;
          mrp?: number;
          last_verified_at?: string;
          is_active?: boolean;
          is_test_seed?: boolean;
          created_at?: string;
          updated_at?: string;
        };
      };
      product_costs: {
        Relationships: [];
        Row: {
          id: string;
          variant_id: string;
          purchase_price: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          variant_id: string;
          purchase_price: number;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          variant_id?: string;
          purchase_price?: number;
          created_at?: string;
          updated_at?: string;
        };
      };
      inventory_movements: {
        Relationships: [];
        Row: {
          id: string;
          variant_id: string;
          change_qty: number;
          previous_stock: number;
          new_stock: number;
          reason: "sale" | "return" | "purchase_bill" | "manual_correction" | "stock_count";
          notes: string | null;
          performed_by: string;
          performed_by_user_id: string | null;
          bill_id: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          variant_id: string;
          change_qty: number;
          previous_stock: number;
          new_stock: number;
          reason: "sale" | "return" | "purchase_bill" | "manual_correction" | "stock_count";
          notes?: string | null;
          performed_by?: string;
          performed_by_user_id?: string | null;
          bill_id?: string | null;
          created_at?: string;
        };
      };
      price_history: {
        Relationships: [];
        Row: {
          id: string;
          variant_id: string;
          price_type: "purchase" | "selling" | "mrp";
          old_price: number | null;
          new_price: number;
          change_reason: string | null;
          bill_id: string | null;
          changed_by: string | null;
          created_at: string;
        };
      };
      bills: {
        Relationships: [];
        Row: {
          id: string;
          supplier_name: string;
          invoice_number: string | null;
          invoice_date: string | null;
          total_amount: number | null;
          file_url: string;
          file_hash: string;
          status: "uploaded" | "extracted" | "verified" | "rejected";
          extracted_data: Json | null;
          created_at: string;
          updated_at: string;
        };
      };
      keep_alive: {
        Relationships: [];
        Row: {
          id: number;
          last_ping_at: string;
          ping_source: string;
        };
      };
    };
    Functions: {
      execute_stock_movement: {
        Args: {
          p_variant_id: string;
          p_change_qty: number;
          p_reason: string;
          p_performed_by: string;
          p_notes?: string | null;
        };
        Returns: Json;
      };
    };

    Enums: {
      [_ in never]: never;
    };

    CompositeTypes: {
      [_ in never]: never;
    };
  };
}
