"use client";

import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import SupabaseSetupNotice from "@/components/SupabaseSetupNotice";
import ControlPanel from "@/components/ControlPanel";

/** Innlogging med 6-sifret engangskode på e-post (Supabase Auth sitt
 * innebygde `signInWithOtp`/`verifyOtp`, ingen egen backend nødvendig).
 * Ligger foran selve kontrollpanelet på "/" — Fjernkontroll og
 * Visningsskjerm er IKKE pakket inn i denne og krever fortsatt ingen
 * innlogging, med vilje (se `supabase/schema.sql`). */
export default function AuthGate({ initialSessionId }: { initialSessionId?: string }) {
  const [authSession, setAuthSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setAuthSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => setAuthSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSignOut = useCallback(() => {
    supabase.auth.signOut();
  }, []);

  if (!isSupabaseConfigured) return <SupabaseSetupNotice />;

  // `undefined` = har ikke rukket å sjekke enda, `null` = sjekket, ikke innlogget.
  if (authSession === undefined) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#080808]">
        <div className="text-sm text-[#555]">Laster…</div>
      </div>
    );
  }

  if (!authSession) {
    return <LoginForm />;
  }

  return (
    <ControlPanel
      initialSessionId={initialSessionId}
      userId={authSession.user.id}
      userEmail={authSession.user.email ?? ""}
      onSignOut={handleSignOut}
    />
  );
}

type Step = "email" | "code";

function LoginForm() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendCooldown, setResendCooldown] = useState(0);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  const sendCode = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = email.trim();
      if (!trimmed) return;
      setBusy(true);
      setError(null);
      const { error } = await supabase.auth.signInWithOtp({ email: trimmed });
      setBusy(false);
      if (error) {
        setError(
          error.message.toLowerCase().includes("rate limit")
            ? "For mange forsøk — vent litt og prøv igjen."
            : "Kunne ikke sende kode: " + error.message
        );
        return;
      }
      setStep("code");
      setResendCooldown(60);
    },
    [email]
  );

  const verifyCode = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = code.trim();
      if (!trimmed) return;
      setBusy(true);
      setError(null);
      const { error } = await supabase.auth.verifyOtp({
        email: email.trim(),
        token: trimmed,
        type: "email",
      });
      setBusy(false);
      if (error) {
        setError(
          error.message.toLowerCase().includes("expired")
            ? "Koden har utløpt — send en ny."
            : "Feil kode — sjekk at du skrev riktig og prøv igjen."
        );
        return;
      }
      // onAuthStateChange i AuthGate tar over herfra og viser kontrollpanelet.
    },
    [email, code]
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#080808] px-6">
      <div className="w-full max-w-sm rounded-2xl border border-[#1e1e1e] bg-[#0e0e0e] p-6 flex flex-col gap-4">
        <div className="text-center mb-1">
          <div className="text-white font-semibold text-lg">Prodpilot</div>
          <div className="text-[#555] text-xs mt-1">Logg inn for å se og redigere programmene dine</div>
        </div>

        {step === "email" && (
          <form onSubmit={sendCode} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-[#555] uppercase tracking-wider">E-post</span>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="deg@eksempel.no"
                className="bg-[#080808] border border-[#2a2a2a] rounded-md text-[#d8d8d8] text-base px-3 py-2.5 focus:outline-none focus:border-[#2563eb]"
              />
            </label>
            {error && <div className="text-[#f87171] text-xs">{error}</div>}
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="rounded-lg border border-[#1e3a70] bg-[#0d1f40] text-[#93c5fd] font-bold text-sm py-2.5 disabled:opacity-40"
            >
              {busy ? "Sender…" : "Send engangskode"}
            </button>
          </form>
        )}

        {step === "code" && (
          <form onSubmit={verifyCode} className="flex flex-col gap-3">
            <div className="text-[11px] text-[#888] leading-relaxed">
              Sendte en 6-sifret kode til <span className="text-[#d8d8d8]">{email}</span>.
              Sjekk innboksen (og evt. spam).
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-[10px] font-bold text-[#555] uppercase tracking-wider">Kode</span>
              <input
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                autoFocus
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, ""))}
                placeholder="123456"
                className="bg-[#080808] border border-[#2a2a2a] rounded-md text-[#d8d8d8] text-base tracking-[0.3em] text-center px-3 py-2.5 focus:outline-none focus:border-[#2563eb]"
              />
            </label>
            {error && <div className="text-[#f87171] text-xs">{error}</div>}
            <button
              type="submit"
              disabled={busy || !code.trim()}
              className="rounded-lg border border-[#1e3a70] bg-[#0d1f40] text-[#93c5fd] font-bold text-sm py-2.5 disabled:opacity-40"
            >
              {busy ? "Sjekker…" : "Logg inn"}
            </button>
            <div className="flex items-center justify-between text-[10px] text-[#555]">
              <button
                type="button"
                className="hover:text-[#888] transition-colors"
                onClick={() => {
                  setStep("email");
                  setCode("");
                  setError(null);
                }}
              >
                ← Bruk en annen e-post
              </button>
              <button
                type="button"
                disabled={resendCooldown > 0 || busy}
                className="hover:text-[#888] transition-colors disabled:opacity-40 disabled:hover:text-[#555]"
                onClick={() => sendCode()}
              >
                {resendCooldown > 0 ? `Send på nytt (${resendCooldown}s)` : "Send på nytt"}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
