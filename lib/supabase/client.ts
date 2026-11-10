import { createBrowserClient } from "@supabase/ssr";
import { Database } from "@/types/database.types";

/**
 * BEGINNER LESSON: Supabase Browser Client
 * This client runs in the browser. It only uses the public "anon" key,
 * which is safe to be seen by users. Database rules (RLS) protect the actual data.
 */

let browserClient: ReturnType<typeof createBrowserClient<Database>> | null = null;

export function getSupabaseBrowserClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // If the user hasn't configured Supabase yet, return null safely
  if (!supabaseUrl || !supabaseAnonKey || supabaseUrl.includes("your-project-ref")) {
    return null;
  }

  if (!browserClient) {
    browserClient = createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
  }

  return browserClient;
}
