"use client";

import { useEffect, useState } from "react";

const ROTATING_WORDS = ["Fabric Mods", "Forge Mods", "Custom Items", "New Biomes", "Magic Spells", "Tech Mods"];

export default function Hero() {
  const [wordIndex, setWordIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setVisible(false);
      setTimeout(() => {
        setWordIndex((i) => (i + 1) % ROTATING_WORDS.length);
        setVisible(true);
      }, 300);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <section className="relative py-20 px-4 text-center overflow-hidden">
      {/* Decorative cubes */}
      <div className="absolute top-8 left-[10%] w-6 h-6 border border-emerald-neon/20 rotate-45 animate-float" style={{ animationDelay: "0s" }} />
      <div className="absolute top-16 right-[15%] w-4 h-4 bg-amber-craft/10 border border-amber-craft/20 rotate-12 animate-float" style={{ animationDelay: "1s" }} />
      <div className="absolute bottom-8 left-[20%] w-3 h-3 bg-emerald-neon/10 border border-emerald-neon/20 rotate-45 animate-float" style={{ animationDelay: "2s" }} />
      <div className="absolute top-12 left-[45%] w-2 h-2 bg-emerald-neon/30 animate-float" style={{ animationDelay: "0.5s" }} />

      {/* Badge */}
      <div className="inline-flex items-center gap-2 bg-stone-900/80 border border-emerald-neon/15 rounded-full px-4 py-1.5 mb-8 animate-slide-up">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-neon animate-pulse" />
        <span className="text-xs font-ui text-emerald-mid tracking-widest uppercase">
          Powered by DeepSeek R1 · Free via OpenRouter
        </span>
      </div>

      {/* Main headline */}
      <h1 className="font-display text-4xl sm:text-5xl lg:text-7xl font-bold text-white mb-4 animate-slide-up" style={{ animationDelay: "60ms" }}>
        Generate
        <br />
        <span
          className={`text-emerald-neon text-glow-green transition-all duration-300 ${visible ? "opacity-100" : "opacity-0"}`}
        >
          {ROTATING_WORDS[wordIndex]}
        </span>
        <br />
        <span className="text-stone-400">with AI</span>
      </h1>

      {/* Sub */}
      <p className="max-w-xl mx-auto text-stone-400 text-sm sm:text-base font-ui leading-relaxed mb-10 animate-slide-up" style={{ animationDelay: "120ms" }}>
        Describe your idea. CodexMC writes complete, working Java mod code — Fabric or Forge — ready to build and play.
      </p>

      {/* Stats row */}
      <div className="flex items-center justify-center gap-8 animate-slide-up" style={{ animationDelay: "180ms" }}>
        {[
          { value: "FREE", label: "No cost" },
          { value: "R1", label: "DeepSeek model" },
          { value: "100%", label: "Java code" },
        ].map(({ value, label }) => (
          <div key={label} className="text-center">
            <div className="font-display font-bold text-xl text-emerald-neon text-glow-green">{value}</div>
            <div className="text-xs text-stone-500 font-ui tracking-wider uppercase mt-0.5">{label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}
