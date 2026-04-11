"use client";

import { useState } from "react";
import Header from "@/components/Header";
import Hero from "@/components/Hero";
import ModGenerator from "@/components/ModGenerator";
import Footer from "@/components/Footer";

export default function Home() {
  const [activeTab, setActiveTab] = useState<"generate" | "chat">("generate");

  return (
    <main className="min-h-screen bg-stone-950 bg-grid relative">
      {/* Ambient glow top */}
      <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] rounded-full bg-emerald-mid/5 blur-[120px] pointer-events-none z-0" />
      <div className="fixed bottom-0 right-0 w-[400px] h-[400px] rounded-full bg-amber-craft/3 blur-[150px] pointer-events-none z-0" />

      <div className="relative z-10">
        <Header activeTab={activeTab} setActiveTab={setActiveTab} />
        <Hero />
        <ModGenerator activeTab={activeTab} />
        <Footer />
      </div>
    </main>
  );
}
