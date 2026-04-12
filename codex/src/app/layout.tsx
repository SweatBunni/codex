import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodexMC — AI Minecraft mod & plugin studio",
  description:
    "Generate Fabric, Forge, and Paper projects with natural language. Streaming OpenRouter coder models, export-ready Gradle ZIPs.",
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
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-black text-white font-mono antialiased min-h-screen overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
