"use client";

import { useChat } from "ai/react";
import { useState, useRef, useEffect } from "react";
import CodeOutput from "./CodeOutput";

const MC_VERSIONS = ["1.21.1", "1.20.4", "1.20.1", "1.19.4", "1.18.2", "1.16.5"];
const LOADERS = ["Fabric", "Forge", "NeoForge"];
const MOD_TYPES = [
  "New Item / Tool",
  "New Block",
  "New Mob / Entity",
  "Biome / World Gen",
  "Magic / Spells",
  "Tech / Automation",
  "Dimension",
  "Custom Command",
  "Event / Mechanic",
  "Other",
];

interface ModGeneratorProps {
  activeTab: "generate" | "chat";
}

export default function ModGenerator({ activeTab }: ModGeneratorProps) {
  const [mcVersion, setMcVersion] = useState("1.20.1");
  const [loader, setLoader] = useState("Fabric");
  const [modType, setModType] = useState("New Item / Tool");
  const [prompt, setPrompt] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const isGenerate = activeTab === "generate";
  const apiEndpoint = isGenerate ? "/api/generate" : "/api/chat";

  const { messages, input, handleInputChange, handleSubmit, isLoading, setInput, setMessages } =
    useChat({
      api: apiEndpoint,
      body: isGenerate ? { modType, mcVersion, loader } : {},
    });

  useEffect(() => {
    setMessages([]);
  }, [activeTab, setMessages]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    handleSubmit(e);
  };

  const lastAssistantMessage = [...messages].reverse().find((m) => m.role === "assistant");

  return (
    <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-20">
      <div className={`grid gap-6 ${isGenerate && lastAssistantMessage ? "lg:grid-cols-2" : "lg:grid-cols-1 max-w-3xl mx-auto"}`}>
        {/* Left panel — input */}
        <div className="space-y-4">
          {/* Config row (generate only) */}
          {isGenerate && (
            <div className="grid grid-cols-3 gap-3 animate-slide-up">
              <div>
                <label className="block text-[10px] text-stone-500 font-ui tracking-widest uppercase mb-1.5">MC Version</label>
                <select
                  value={mcVersion}
                  onChange={(e) => setMcVersion(e.target.value)}
                  className="w-full bg-stone-900/80 border border-white/6 rounded-lg px-3 py-2 text-xs font-mono text-stone-200 focus:outline-none focus:border-emerald-neon/40 transition-colors"
                >
                  {MC_VERSIONS.map((v) => (
                    <option key={v} value={v}>{v}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-stone-500 font-ui tracking-widest uppercase mb-1.5">Loader</label>
                <select
                  value={loader}
                  onChange={(e) => setLoader(e.target.value)}
                  className="w-full bg-stone-900/80 border border-white/6 rounded-lg px-3 py-2 text-xs font-mono text-stone-200 focus:outline-none focus:border-emerald-neon/40 transition-colors"
                >
                  {LOADERS.map((l) => (
                    <option key={l} value={l}>{l}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-stone-500 font-ui tracking-widest uppercase mb-1.5">Type</label>
                <select
                  value={modType}
                  onChange={(e) => setModType(e.target.value)}
                  className="w-full bg-stone-900/80 border border-white/6 rounded-lg px-3 py-2 text-xs font-mono text-stone-200 focus:outline-none focus:border-emerald-neon/40 transition-colors"
                >
                  {MOD_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* Message history (chat mode) */}
          {!isGenerate && messages.length > 0 && (
            <div className="bg-stone-900/50 border border-white/6 rounded-xl p-4 space-y-4 max-h-96 overflow-y-auto animate-fade-in">
              {messages.map((m) => (
                <div key={m.id} className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}>
                  <div className={`flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-xs font-bold ${
                    m.role === "user"
                      ? "bg-amber-craft/20 text-amber-craft border border-amber-craft/20"
                      : "bg-emerald-neon/10 text-emerald-neon border border-emerald-neon/20"
                  }`}>
                    {m.role === "user" ? "U" : "AI"}
                  </div>
                  <div className={`flex-1 rounded-lg px-3 py-2 text-sm font-ui leading-relaxed ${
                    m.role === "user"
                      ? "bg-amber-craft/5 border border-amber-craft/10 text-stone-200 text-right"
                      : "bg-stone-800/60 border border-white/5 text-stone-300"
                  }`}>
                    <pre className="whitespace-pre-wrap font-ui text-xs sm:text-sm">{m.content}</pre>
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="flex gap-3">
                  <div className="flex-shrink-0 w-7 h-7 rounded-md bg-emerald-neon/10 text-emerald-neon border border-emerald-neon/20 flex items-center justify-center text-xs font-bold">AI</div>
                  <div className="bg-stone-800/60 border border-white/5 rounded-lg px-3 py-2">
                    <span className="shimmer inline-block w-20 h-3 rounded" />
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}

          {/* Input area */}
          <form onSubmit={handleGenerate} className="animate-slide-up" style={{ animationDelay: "120ms" }}>
            <div className="bg-stone-900/80 border border-white/6 rounded-xl overflow-hidden focus-within:border-emerald-neon/30 transition-all duration-200 focus-within:glow-green-sm">
              {/* Terminal header bar */}
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/5 bg-stone-950/40">
                <div className="flex gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full bg-stone-700" />
                  <div className="w-2.5 h-2.5 rounded-full bg-stone-700" />
                  <div className="w-2.5 h-2.5 rounded-full bg-stone-700" />
                </div>
                <span className="text-[10px] text-stone-600 font-ui tracking-widest ml-2">
                  {isGenerate ? "codexmc://generate" : "codexmc://chat"}
                </span>
              </div>

              {/* Prompt area */}
              <div className="relative p-4">
                <span className="absolute top-4 left-4 text-emerald-neon font-mono text-sm select-none">❯</span>
                <textarea
                  value={input}
                  onChange={handleInputChange}
                  placeholder={
                    isGenerate
                      ? "Describe your mod idea... e.g. 'A sword that shoots lightning when right-clicked, dealing 8 damage to nearby enemies'"
                      : "Ask anything about Minecraft modding..."
                  }
                  rows={5}
                  className="w-full bg-transparent pl-6 text-sm font-mono text-stone-200 placeholder:text-stone-600 focus:outline-none resize-none leading-relaxed"
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                      handleGenerate(e as any);
                    }
                  }}
                />
              </div>

              {/* Action bar */}
              <div className="flex items-center justify-between px-4 py-3 border-t border-white/5 bg-stone-950/20">
                <div className="flex items-center gap-3 text-[10px] text-stone-600 font-ui">
                  <span>⌘+Enter to send</span>
                  {isGenerate && (
                    <span className="text-emerald-mid/60">
                      {loader} · {mcVersion}
                    </span>
                  )}
                </div>
                <div className="flex gap-2">
                  {messages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setMessages([])}
                      className="px-3 py-1.5 text-xs font-display text-stone-500 hover:text-stone-300 border border-white/5 rounded-lg transition-colors"
                    >
                      CLEAR
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={isLoading || !input.trim()}
                    className="relative px-5 py-1.5 bg-emerald-neon/10 hover:bg-emerald-neon/20 border border-emerald-neon/30 hover:border-emerald-neon/60 text-emerald-neon font-display text-xs tracking-widest rounded-lg transition-all duration-200 disabled:opacity-40 disabled:cursor-not-allowed group"
                  >
                    {isLoading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-3 h-3 border border-emerald-neon/50 border-t-emerald-neon rounded-full animate-spin" />
                        GENERATING
                      </span>
                    ) : (
                      <span>{isGenerate ? "⚡ GENERATE" : "SEND →"}</span>
                    )}
                  </button>
                </div>
              </div>
            </div>
          </form>

          {/* Quick prompts (generate only, when empty) */}
          {isGenerate && messages.length === 0 && (
            <div className="animate-slide-up" style={{ animationDelay: "180ms" }}>
              <p className="text-[10px] text-stone-600 font-ui tracking-widest uppercase mb-2">Quick ideas</p>
              <div className="flex flex-wrap gap-2">
                {[
                  "Lightning sword that shocks nearby enemies",
                  "Grappling hook item for traversal",
                  "Ore that spawns in the Nether and glows",
                  "Backpack block with 27-slot inventory",
                ].map((idea) => (
                  <button
                    key={idea}
                    onClick={() => setInput(idea)}
                    className="px-3 py-1.5 text-xs font-ui text-stone-400 hover:text-emerald-neon bg-stone-900/60 hover:bg-emerald-neon/5 border border-white/5 hover:border-emerald-neon/20 rounded-lg transition-all duration-200"
                  >
                    {idea}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right panel — output (generate mode) */}
        {isGenerate && lastAssistantMessage && (
          <div className="animate-slide-up">
            <CodeOutput
              content={lastAssistantMessage.content}
              isStreaming={isLoading}
              mcVersion={mcVersion}
              loader={loader}
            />
          </div>
        )}
      </div>
    </section>
  );
}
