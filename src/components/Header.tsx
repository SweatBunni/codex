"use client";

interface HeaderProps {
  activeTab: "generate" | "chat";
  setActiveTab: (tab: "generate" | "chat") => void;
}

export default function Header({ activeTab, setActiveTab }: HeaderProps) {
  return (
    <header className="sticky top-0 z-50 border-b border-white/5 bg-stone-950/80 backdrop-blur-xl">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-8 h-8 bg-emerald-mid rounded-sm pixel-shadow flex items-center justify-center text-stone-950 font-display font-bold text-sm">
                C
              </div>
              <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-emerald-neon rounded-sm animate-pulse" />
            </div>
            <div className="flex flex-col">
              <span className="font-display font-bold text-white text-sm tracking-widest uppercase">
                Codex<span className="text-emerald-neon">MC</span>
              </span>
              <span className="text-stone-500 text-[10px] tracking-wider font-ui">
                AI MOD GENERATOR
              </span>
            </div>
          </div>

          {/* Nav tabs */}
          <nav className="flex items-center gap-1 bg-stone-900/60 border border-white/5 rounded-lg p-1">
            <button
              onClick={() => setActiveTab("generate")}
              className={`relative px-4 py-2 rounded-md text-xs font-display tracking-wider transition-all duration-200 ${
                activeTab === "generate"
                  ? "bg-stone-800 text-emerald-neon glow-green-sm border border-emerald-neon/20"
                  : "text-stone-400 hover:text-stone-200"
              }`}
            >
              {activeTab === "generate" && (
                <span className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-emerald-neon glow-green-sm" />
              )}
              <span className={activeTab === "generate" ? "ml-2" : ""}>
                ⚡ GENERATE
              </span>
            </button>
            <button
              onClick={() => setActiveTab("chat")}
              className={`relative px-4 py-2 rounded-md text-xs font-display tracking-wider transition-all duration-200 ${
                activeTab === "chat"
                  ? "bg-stone-800 text-emerald-neon glow-green-sm border border-emerald-neon/20"
                  : "text-stone-400 hover:text-stone-200"
              }`}
            >
              {activeTab === "chat" && (
                <span className="absolute left-2 top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full bg-emerald-neon glow-green-sm" />
              )}
              <span className={activeTab === "chat" ? "ml-2" : ""}>
                💬 CHAT
              </span>
            </button>
          </nav>

          {/* Status */}
          <div className="flex items-center gap-2 text-xs text-stone-500 font-ui">
            <div className="status-dot" />
            <span className="hidden sm:inline">OpenRouter</span>
            <span className="text-emerald-mid hidden sm:inline">LIVE</span>
          </div>
        </div>
      </div>
    </header>
  );
}
