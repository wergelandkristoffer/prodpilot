import type { Metadata } from "next";
import "./globals.css";

// Merk: bruker Tailwinds system-font-stack (font-sans) i stedet for
// next/font/google, slik at produksjonsbygget aldri er avhengig av å nå
// fonts.googleapis.com. Bytt gjerne til next/font/google eller next/font/local
// senere hvis dere vil selv-hoste Inter.

export const metadata: Metadata = {
  title: "Prodpilot",
  description: "Sanntids programstyring for events og bryllup.",
  icons: {
    icon: [
      // Svart merke på lys bakgrunn, hvitt merke på mørk bakgrunn — nettleseren
      // velger automatisk ut fra brukerens system-/nettleserinnstilling.
      { url: "/favicon-light.png", media: "(prefers-color-scheme: light)" },
      { url: "/favicon-dark.png", media: "(prefers-color-scheme: dark)" },
    ],
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="no" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-[#080808] text-[#d8d8d8] font-sans">
        {children}
      </body>
    </html>
  );
}
