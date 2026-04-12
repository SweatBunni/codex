"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  h1: (p) => <h1 className="text-lg font-semibold text-white mt-4 mb-2 border-b border-[#222] pb-1" {...p} />,
  h2: (p) => <h2 className="text-base font-semibold text-white mt-3 mb-2" {...p} />,
  h3: (p) => <h3 className="text-sm font-semibold text-white mt-2 mb-1" {...p} />,
  p: (p) => <p className="text-sm text-neutral-300 leading-relaxed my-2" {...p} />,
  ul: (p) => <ul className="list-disc pl-5 text-sm text-neutral-300 my-2 space-y-1" {...p} />,
  ol: (p) => <ol className="list-decimal pl-5 text-sm text-neutral-300 my-2 space-y-1" {...p} />,
  li: (p) => <li className="leading-relaxed" {...p} />,
  a: (p) => (
    <a className="text-white underline underline-offset-2 hover:text-neutral-200" target="_blank" rel="noreferrer" {...p} />
  ),
  blockquote: (p) => (
    <blockquote className="border-l-2 border-neutral-600 pl-3 my-2 text-neutral-400 text-sm italic" {...p} />
  ),
  table: (p) => (
    <div className="overflow-x-auto my-3 border border-[#222] rounded-lg">
      <table className="w-full text-xs text-left text-neutral-300" {...p} />
    </div>
  ),
  thead: (p) => <thead className="bg-[#111] text-neutral-200" {...p} />,
  th: (p) => <th className="px-3 py-2 font-medium border-b border-[#222]" {...p} />,
  td: (p) => <td className="px-3 py-2 border-b border-[#1a1a1a]" {...p} />,
  hr: () => <hr className="border-[#222] my-4" />,
  code: ({ className, children, ...props }) => {
    const inline = !className;
    if (inline) {
      return (
        <code className="px-1 py-0.5 rounded bg-[#111] text-neutral-200 text-[0.85em] font-mono" {...props}>
          {children}
        </code>
      );
    }
    return (
      <code className={`font-mono text-xs ${className || ""}`} {...props}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="my-3 rounded-lg border border-[#222] bg-[#0a0a0a] p-4 overflow-x-auto text-xs leading-relaxed">
      {children}
    </pre>
  ),
};

export default function MarkdownMessage({ content }: { content: string }) {
  return (
    <div className="markdown-body max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
