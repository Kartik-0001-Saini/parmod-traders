import { createClient } from "@supabase/supabase-js";
import { Database } from "@/types/database.types";

/**
 * BEGINNER LESSON: Service Role Admin Client (CRITICAL SECURITY)
 * This client uses the super-secret SUPABASE_SERVICE_ROLE_KEY.
 * It bypasses Row Level Security (RLS) and can perform any database operation.
 * NEVER import this file into a client component or expose it to the browser!
 */

export function getSupabaseAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey || supabaseUrl.includes("your-project-ref")) {
    return null;
  }

  return createClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}
