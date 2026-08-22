import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const isSupabaseConfigured = Boolean(url && anonKey);

if (!isSupabaseConfigured) {
  // Vises i konsollen (server + browser) hvis miljøvariablene mangler.
  // Vi bruker en gyldig placeholder-URL under for å unngå at
  // createClient() kaster ("supabaseUrl is required") og krasjer hele
  // appen ved SSR — se .env.local.example for oppsett.
  console.warn(
    "[Prodpilot] Mangler NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Kopier .env.local.example til .env.local og fyll inn verdiene fra Supabase-prosjektet ditt."
  );
}

export const supabase = createClient(
  url || "https://placeholder.invalid",
  anonKey || "placeholder-anon-key",
  { realtime: { params: { eventsPerSecond: 10 } } }
);
