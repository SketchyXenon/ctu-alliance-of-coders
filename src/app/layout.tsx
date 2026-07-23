import type { Metadata } from "next";
import { Space_Grotesk, IBM_Plex_Sans, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as SonnerToaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";

const spaceGrotesk = Space_Grotesk({
  variable: "--font-space-grotesk",
  subsets: ["latin"],
  display: "swap",
});

const ibmPlexSans = IBM_Plex_Sans({
  variable: "--font-ibm-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = "https://allianceofcoders.ph";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Alliance of Coders - CTU Danao Campus",
    template: "%s | Alliance of Coders",
  },
  description:
    "Building the future, one commit at a time. The official site of the Alliance of Coders at Cebu Technological University - Danao Campus: announcements, officers, and contact.",
  keywords: [
    "Alliance of Coders",
    "CTU Danao",
    "Cebu Technological University",
    "student tech organization",
    "coding club",
    "developers",
    "Philippines",
  ],
  authors: [{ name: "Alliance of Coders" }],
  creator: "Alliance of Coders",
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  openGraph: {
    title: "Alliance of Coders - CTU Danao Campus",
    description:
      "A community of developers, innovators, and tech leaders at CTU Danao.",
    url: siteUrl,
    siteName: "Alliance of Coders",
    type: "website",
    locale: "en_PH",
  },
  twitter: {
    card: "summary_large_image",
    title: "Alliance of Coders - CTU Danao Campus",
    description:
      "A community of developers, innovators, and tech leaders at CTU Danao.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const orgJsonLd = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Alliance of Coders",
    alternateName: "AoC",
    url: siteUrl,
    logo: `${siteUrl}/logo.svg`,
    description:
      "A community of passionate developers, innovators, and tech leaders at Cebu Technological University - Danao Campus, united by code.",
    foundingLocation: {
      "@type": "Place",
      name: "Cebu Technological University - Danao Campus",
      address: {
        "@type": "PostalAddress",
        addressLocality: "Danao City",
        addressRegion: "Cebu",
        addressCountry: "PH",
      },
    },
    sameAs: [
      "https://facebook.com/allianceofcoders",
      "https://github.com/allianceofcoders",
    ],
  };

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          // Prevent theme flash: set the class before hydration.
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('aoc-theme-v1');var m=window.matchMedia('(prefers-color-scheme: dark)').matches;if(t==='dark'||(!t&&m)){document.documentElement.classList.add('dark')}}catch(e){}})()`,
          }}
        />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(orgJsonLd) }}
        />
      </head>
      <body
        className={`${spaceGrotesk.variable} ${ibmPlexSans.variable} ${geistMono.variable} antialiased`}
      >
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          storageKey="aoc-theme-v1"
        >
          {children}
          <Toaster />
          <SonnerToaster position="bottom-right" />
        </ThemeProvider>
      </body>
    </html>
  );
}
