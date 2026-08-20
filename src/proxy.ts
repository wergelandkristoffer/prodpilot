import { NextRequest, NextResponse } from "next/server";

// Next.js 16: "middleware.ts" er erstattet av "proxy.ts" (samme funksjonalitet, nytt navn).
//
// Denne pleide å tvinge alle mobil-nettlesere som åpnet "/" eller
// "/display/[id]" videre til "/remote/[id]" — tanken var at kontrollpanelet
// og visningsskjermen bare var ment for PC. Brukeren ønsker nå å faktisk
// kunne redigere/styre programmet OG se visningsskjermen på mobil også
// (kontrollpanelet og visningsskjermen har fått egne mobiltilpasninger for
// dette), så det tvungne hoppet til fjernkontroll er fjernet. Fjernkontroll-
// lenken (`/remote/[id]`) er fortsatt et helt eget, kun-delt-ved-lenke
// endepunkt — det skjer ingen automatikk som gir noen tilgang til den.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function proxy(request: NextRequest) {
  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/display/:path*"],
};
