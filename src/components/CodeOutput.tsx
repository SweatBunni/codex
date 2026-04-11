"use client";

import { useState, useMemo } from "react";

interface CodeFile {
  name: string;
  language: string;
  content: string;
}

interface CodeOutputProps {
  content: string;
  isStreaming: boolean;
  mcVersion: string;
  loader: string;
}

function parseCodeBlocks(raw: string): { files: CodeFile[]; prose: string } {
  const files: CodeFile[] = [];
  const codeBlockRegex = /```(\w+)?\s*([^\n]*)\n([\s\S]*?)```/g;
  let match;
  let prose = raw;

  while ((match = codeBlockRegex.exec(raw)) !== null) {
    const lang = match[1] || "text";
    const filename = match[2]?.trim() || `file.${lang}`;
    const code = match[3] || "";
    files.push({ name: filename || `${lang}-${files.length + 1}`, language: lang, content: code });
    prose = prose.replace(match[0], "");
  }

  return { files, prose: prose.trim() };
}

function getLanguageColor(lang: string) {
  const colors: Record<string, string> = {
    java: "text-amber-craft",
    json: "text-emerald-neon",
    gradle: "text-blue-400",
    groovy: "text-blue-400",
    toml: "text-purple-400",
    kotlin: "text-orange-400",
    yaml: "text-cyan-400",
    xml: "text-red-400",
    text: "text-stone-400",
  };
  return colors[lang.toLowerCase()] || "text-stone-400";
}

export default function CodeOutput({ content, isStreaming, mcVersion, loader }: CodeOutputProps) {
  const [activeFile, setActiveFile] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  const { files, prose } = useMemo(() => parseCodeBlocks(content), [content]);

  const handleCopy = async (text: string, all = false) => {
    await navigator.clipboard.writeText(text);
    if (all) {
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } else {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const activeCode = files[activeFile]?.content || "";

  return (
    <div className="bg-stone-900/60 border border-white/6 rounded-xl overflow-hidden flex flex-col h-full min-h-[500px]">
      {/* Output header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/5 bg-stone-950/40">
        <div className="flex items-center gap-3">
          {isStreaming ? (
            <span className="flex items-center gap-2 text-xs font-ui text-emerald-neon">
              <span className="w-2 h-2 rounded-full bg-emerald-neon animate-pulse" />
              GENERATING...
            </span>
          ) : (
            <span className="flex items-center gap-2 text-xs font-ui text-stone-400">
              <span className="w-2 h-2 rounded-full bg-emerald-mid" />
              COMPLETE · {loader} {mcVersion}
            </span>
          )}
          {files.length > 0 && (
            <span className="text-[10px] text-stone-600 font-ui">
              {files.length} file{files.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {files.length > 0 && (
          <button
            onClick={() => handleCopy(files.map((f) => `// ${f.name}\n${f.content}`).join("\n\n---\n\n"), true)}
            className="text-[10px] font-display text-stone-500 hover:text-emerald-neon border border-white/5 hover:border-emerald-neon/20 rounded px-2 py-1 transition-all"
          >
            {copiedAll ? "✓ COPIED ALL" : "COPY ALL"}
          </button>
        )}
      </div>

      {/* Prose description */}
      {prose && (
        <div className="px-4 py-3 border-b border-white/5 text-xs text-stone-400 font-ui leading-relaxed bg-stone-950/20">
          {prose.split("\n").slice(0, 6).join("\n")}
        </div>
      )}

      {/* File tabs */}
      {files.length > 0 && (
        <div className="flex gap-0 border-b border-white/5 overflow-x-auto bg-stone-950/30">
          {files.map((file, i) => (
            <button
              key={i}
              onClick={() => setActiveFile(i)}
              className={`flex items-center gap-2 px-4 py-2.5 text-[11px] font-mono whitespace-nowrap border-r border-white/5 transition-all duration-150 ${
                activeFile === i
                  ? "bg-stone-800/80 text-stone-100 border-t-2 border-t-emerald-neon/60 -mt-px"
                  : "text-stone-500 hover:text-stone-300 hover:bg-stone-800/30"
              }`}
            >
              <span className={`text-[10px] ${getLanguageColor(file.language)}`}>●</span>
              {file.name}
            </button>
          ))}
        </div>
      )}

      {/* Code view */}
      <div className="flex-1 relative overflow-hidden">
        {files.length > 0 ? (
          <>
            <div className="absolute top-3 right-3 z-10">
              <button
                onClick={() => handleCopy(activeCode)}
                className="text-[10px] font-display text-stone-500 hover:text-emerald-neon bg-stone-950/80 border border-white/5 hover:border-emerald-neon/20 rounded px-2 py-1 transition-all"
              >
                {copied ? "✓ COPIED" : "COPY"}
              </button>
            </div>
            <div className="overflow-auto h-full max-h-[500px]">
              <pre className="code-block border-0 rounded-none p-4 pr-16 text-xs leading-relaxed text-stone-300 min-h-full">
                <code>{activeCode}</code>
              </pre>
            </div>
          </>
        ) : isStreaming ? (
          <div className="p-6 space-y-3">
            {[80, 60, 90, 50, 70].map((w, i) => (
              <div key={i} className="shimmer h-3 rounded" style={{ width: `${w}%` }} />
            ))}
          </div>
        ) : (
          <div className="p-6 text-xs text-stone-500 font-ui whitespace-pre-wrap leading-relaxed">
            {content}
          </div>
        )}
      </div>

      {/* Footer */}
      {!isStreaming && files.length > 0 && (
        <div className="px-4 py-2 border-t border-white/5 bg-stone-950/30 flex items-center justify-between">
          <span className="text-[10px] text-stone-600 font-ui">
            {activeCode.split("\n").length} lines · {files[activeFile]?.language}
          </span>
          <span className="text-[10px] text-stone-600 font-ui">
            Generated by DeepSeek via OpenRouter
          </span>
        </div>
      )}
    </div>
  );
}
