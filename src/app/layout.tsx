import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodexMC — AI Minecraft Mod Generator",
  description: "Generate Minecraft mods with AI. Powered by DeepSeek via OpenRouter.",
  icons: { icon: "/favicon.ico" },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Mono:ital,wght@0,400;0,700;1,400&family=JetBrains+Mono:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@300;400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-stone-950 text-stone-100 font-mono antialiased min-h-screen overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
