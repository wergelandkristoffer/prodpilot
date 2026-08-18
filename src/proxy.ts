import { NextRequest, NextResponse } from "next/server";

/** Enkel UA-sniffing – iPad ekskluderes bevisst (fungerer fint som kontrollpanel/visning). */
function isMobile(ua: string): boolean {
  return /Android|iPhone|iPod|Mobile|Windows Phone/i.test(ua) && !/iPad/i.test(ua);
}

// Next.js 16: "middleware.ts" er erstattet av "proxy.ts" (samme funksjonalitet, nytt navn).
export function proxy(request: NextRequest) {
  const ua = request.headers.get("user-agent") || "";
  if (!isMobile(ua)) return NextResponse.next();

  const { pathname, searchParams } = request.nextUrl;

  // Allerede på fjernkontroll, statiske filer eller API – ikke gjør noe.
  if (
    pathname.startsWith("/remote") ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  // Kontrollpanelet (desktop-verktøy) åpnet på mobil -> send til fjernkontroll.
  // Sesjonen kan følge med som ?s=<id> (kontrollpanelet legger dette i URL-en).
  if (pathname === "/") {
    const sessionId = searchParams.get("s");
    const url = request.nextUrl.clone();
    url.pathname = sessionId ? `/remote/${sessionId}` : "/remote";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // Visningsskjerm-lenke åpnet på en telefon -> gi fjernkontroll for samme sesjon i stedet.
  const displayMatch = pathname.match(/^\/display\/([^/]+)/);
  if (displayMatch) {
    const url = request.nextUrl.clone();
    url.pathname = `/remote/${displayMatch[1]}`;
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/display/:path*"],
};
