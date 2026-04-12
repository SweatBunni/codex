export default function Footer() {
  return (
    <footer className="border-t border-white/5 py-8 px-4">
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-6 h-6 bg-emerald-mid rounded-sm pixel-shadow flex items-center justify-center text-stone-950 font-display font-bold text-xs">
            C
          </div>
          <div>
            <span className="font-display text-xs text-white tracking-widest">
              Codex<span className="text-emerald-neon">MC</span>
            </span>
            <span className="text-stone-600 text-[10px] font-ui ml-2">v2.0</span>
          </div>
        </div>

        <div className="flex items-center gap-6 text-[10px] text-stone-600 font-ui tracking-wider">
          <a
            href="https://openrouter.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-emerald-mid transition-colors"
          >
            OpenRouter
          </a>
          <a
            href="https://sdk.vercel.ai"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-emerald-mid transition-colors"
          >
            Vercel AI SDK
          </a>
          <a
            href="https://fabricmc.net"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-emerald-mid transition-colors"
          >
            Fabric
          </a>
          <a
            href="https://github.com/SweatBunni/codex"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-emerald-mid transition-colors"
          >
            GitHub ↗
          </a>
        </div>

        <div className="text-[10px] text-stone-700 font-ui">
          No API cost · DeepSeek R1:free
        </div>
      </div>
    </footer>
  );
}
