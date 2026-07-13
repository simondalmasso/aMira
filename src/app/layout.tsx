import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// V3.1: Preview identity switched from bank (🏦) to analytics (📊) per spec
// ORACLE_UI_CAPITAL_DECISION_ENGINE_V3_FIX — share-preview iconography must
// reflect the chart/analytics identity, not the bank identity.
export const metadata: Metadata = {
  title: "Predicciones Amira vision — Analítica Multi-Activo",
  description: "Dashboard en vivo de Predicciones Amira vision para mercados argentinos — FCI, Plazo Fijo, Acciones, Bonos, CEDEARs y ETFs con motor de decisión dinámico.",

  icons: {
    icon: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>📊</text></svg>",
  },

  openGraph: {
    title: "Predicciones Amira vision — Analítica Multi-Activo",
    description: "Dashboard en vivo de Predicciones Amira vision para mercados argentinos. Motor de decisión dinámico con capital, slider de riesgo y escenarios de stress.",
    type: "website",
    siteName: "Predicciones Amira vision",
  },

  twitter: {
    card: "summary",
    title: "Predicciones Amira vision — Analítica Multi-Activo",
    description: "Dashboard en vivo de Predicciones Amira vision para mercados argentinos.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-white text-black`}
      >
        {children}
      </body>
    </html>
  );
}
