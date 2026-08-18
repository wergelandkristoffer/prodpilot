export default function SupabaseSetupNotice() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#080808] px-6">
      <div className="max-w-md text-center text-sm text-[#888] leading-relaxed">
        <div className="text-white font-semibold mb-2">Supabase er ikke koblet til enda</div>
        <p>
          Kopier <code className="text-[#4ade80]">.env.local.example</code> til{" "}
          <code className="text-[#4ade80]">.env.local</code>, fyll inn{" "}
          <code className="text-[#4ade80]">NEXT_PUBLIC_SUPABASE_URL</code> og{" "}
          <code className="text-[#4ade80]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code> fra
          Supabase-prosjektet ditt, og kjør <code className="text-[#4ade80]">supabase/schema.sql</code>{" "}
          i SQL Editor. Se README for hele oppsettet.
        </p>
      </div>
    </div>
  );
}
