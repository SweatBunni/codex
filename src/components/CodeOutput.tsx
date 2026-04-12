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
    java: "text-neutral-200",
    json: "text-neutral-300",
    gradle: "text-neutral-300",
    groovy: "text-neutral-300",
    toml: "text-neutral-300",
    kotlin: "text-neutral-200",
    yaml: "text-neutral-400",
    xml: "text-neutral-400",
    text: "text-neutral-500",
  };
  return colors[lang.toLowerCase()] || "text-neutral-500";
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
    <div className="bg-[#0a0a0a] border border-[#222] rounded-xl overflow-hidden flex flex-col h-full min-h-[320px]">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#222] bg-black">
        <div className="flex items-center gap-3 min-w-0">
          {isStreaming ? (
            <span className="flex items-center gap-2 text-xs font-mono text-neutral-400">
              <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
              streaming…
            </span>
          ) : (
            <span className="flex items-center gap-2 text-xs font-mono text-neutral-500">
              <span className="w-2 h-2 rounded-full bg-neutral-600" />
              {loader} · {mcVersion}
            </span>
          )}
          {files.length > 0 && (
            <span className="text-[10px] text-neutral-600 font-mono truncate">
              {files.length} file{files.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        {files.length > 0 && (
          <button
            type="button"
            onClick={() => handleCopy(files.map((f) => `// ${f.name}\n${f.content}`).join("\n\n---\n\n"), true)}
            className="text-[10px] font-mono text-neutral-500 hover:text-white border border-[#222] hover:border-neutral-500 rounded px-2 py-1 transition-colors shrink-0"
          >
            {copiedAll ? "copied" : "copy all"}
          </button>
        )}
      </div>

      {prose && (
        <div className="px-4 py-3 border-b border-[#222] text-xs text-neutral-500 font-mono leading-relaxed bg-black max-h-24 overflow-y-auto">
          {prose.split("\n").slice(0, 8).join("\n")}
        </div>
      )}

      {files.length > 0 && (
        <div className="flex gap-0 border-b border-[#222] overflow-x-auto bg-[#111]">
          {files.map((file, i) => (
            <button
              type="button"
              key={i}
              onClick={() => setActiveFile(i)}
              className={`flex items-center gap-2 px-4 py-2.5 text-[11px] font-mono whitespace-nowrap border-r border-[#222] transition-colors ${
                activeFile === i ? "bg-[#1a1a1a] text-white" : "text-neutral-500 hover:text-neutral-200"
              }`}
            >
              <span className={`text-[10px] ${getLanguageColor(file.language)}`}>●</span>
              {file.name}
            </button>
          ))}
        </div>
      )}

      <div className="flex-1 relative overflow-hidden">
        {files.length > 0 ? (
          <>
            <div className="absolute top-3 right-3 z-10">
              <button
                type="button"
                onClick={() => handleCopy(activeCode)}
                className="text-[10px] font-mono text-neutral-500 hover:text-white bg-black/90 border border-[#222] rounded px-2 py-1 transition-colors"
              >
                {copied ? "copied" : "copy"}
              </button>
            </div>
            <div className="overflow-auto h-full max-h-[420px]">
              <pre className="code-block border-0 rounded-none p-4 pr-16 text-xs leading-relaxed text-neutral-300 min-h-full">
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
          <div className="p-6 text-xs text-neutral-600 font-mono whitespace-pre-wrap leading-relaxed">{content}</div>
        )}
      </div>

      {!isStreaming && files.length > 0 && (
        <div className="px-4 py-2 border-t border-[#222] bg-black flex items-center justify-between">
          <span className="text-[10px] text-neutral-600 font-mono">
            {activeCode.split("\n").length} lines · {files[activeFile]?.language}
          </span>
          <span className="text-[10px] text-neutral-600 font-mono">OpenRouter</span>
        </div>
      )}
    </div>
  );
}
