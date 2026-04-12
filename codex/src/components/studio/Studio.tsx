"use client";

import { useChat } from "ai/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import MarkdownMessage from "./MarkdownMessage";
import CodeOutput from "@/components/CodeOutput";
import type { StoredChat, StoredMessage } from "@/lib/chat-store";
import { LOADERS_MOD, mcVersionsFor, pickMcVersionForLoader } from "@/lib/mc-versions";

function newClientChat(): StoredChat {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `local-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  return {
    id,
    title: "New project",
    updatedAt: now,
    mcVersion: "1.20.1",
    loader: "Fabric",
    projectKind: "mod",
    generationMode: "simple",
    messages: [],
  };
}

function toUiMessages(msgs: StoredMessage[]) {
  return msgs.map((m) => ({ id: m.id, role: m.role as "user" | "assistant" | "system", content: m.content }));
}

function StudioSession({
  chat,
  onPersisted,
  persistEnabled,
}: {
  chat: StoredChat;
  onPersisted: () => void;
  persistEnabled: boolean;
}) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { messages, input, handleInputChange, handleSubmit, isLoading, stop, reload, append, error } = useChat({
    id: chat.id,
    api: "/api/chat",
    initialMessages: toUiMessages(chat.messages),
    body: {
      mcVersion: chat.mcVersion,
      loader: chat.loader,
      projectKind: chat.projectKind,
      generationMode: chat.generationMode,
    },
  });

  const schedulePersist = useCallback(
    (next: typeof messages) => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
      persistTimer.current = setTimeout(async () => {
        const stored: StoredMessage[] = next.map((m) => ({
          id: m.id,
          role: m.role as StoredMessage["role"],
          content: m.content,
          createdAt: new Date().toISOString(),
        }));
        await fetch(`/api/chats/${chat.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: stored }),
        });
        onPersisted();
      }, 450);
    },
    [chat.id, onPersisted]
  );

  useEffect(() => {
    if (!persistEnabled) return;
    schedulePersist(messages);
  }, [messages, schedulePersist, persistEnabled]);

  useEffect(
    () => () => {
      if (persistTimer.current) clearTimeout(persistTimer.current);
    },
    []
  );

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, isLoading]);

  const lastAssistant = useMemo(() => [...messages].reverse().find((m) => m.role === "assistant"), [messages]);

  const [jarBuilding, setJarBuilding] = useState(false);
  const [exportHint, setExportHint] = useState<string | null>(null);

  const downloadExport = async (includeJarGuide: boolean) => {
    const md = lastAssistant?.content;
    if (!md) return;
    setExportHint(null);
    const res = await fetch("/api/export", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        markdown: md,
        projectName: chat.title,
        includeJarGuide,
      }),
    });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const stem = chat.title.replace(/\s+/g, "-").toLowerCase() || "codexmc";
    a.download = includeJarGuide ? `${stem}-project-and-jar-howto.zip` : `${stem}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadBuiltJar = async () => {
    const md = lastAssistant?.content;
    if (!md) return;
    setJarBuilding(true);
    setExportHint(null);
    try {
      const res = await fetch("/api/build-jar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown: md, projectName: chat.title }),
      });
      const ct = res.headers.get("content-type") || "";
      if (res.ok && (ct.includes("java-archive") || ct.includes("octet-stream"))) {
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        const stem = chat.title.replace(/\s+/g, "-").toLowerCase() || "codexmc";
        a.download = `${stem}.jar`;
        a.click();
        URL.revokeObjectURL(url);
        setExportHint("Built on server — JAR downloaded.");
        return;
      }
      let errMsg = res.statusText;
      let buildLog = "";
      try {
        const j = (await res.json()) as { error?: string; buildLog?: string };
        errMsg = j.error || errMsg;
        buildLog = j.buildLog || "";
      } catch {
        /* ignore */
      }
      setExportHint(errMsg);
      if (buildLog) {
        const logBlob = new Blob([buildLog], { type: "text/plain;charset=utf-8" });
        const logUrl = URL.createObjectURL(logBlob);
        const la = document.createElement("a");
        la.href = logUrl;
        la.download = `${chat.title.replace(/\s+/g, "-").toLowerCase() || "codexmc"}-build-log.txt`;
        la.click();
        URL.revokeObjectURL(logUrl);
      }
    } finally {
      setJarBuilding(false);
    }
  };

  return (
    <div className="flex flex-1 min-h-0 min-w-0 flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
        <div className="mx-auto max-w-3xl space-y-6">
          {messages.length === 0 && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rounded-xl border border-[#222] bg-[#0a0a0a] p-6 text-sm text-neutral-400 leading-relaxed"
            >
              <p className="text-white font-medium mb-2">CodexMC studio</p>
              <p>
                Each conversation is one mod or plugin project. Describe what you want (items, blocks, Paper economy
                plugins, worldgen, GUIs). The model returns a full tree: Java sources, Gradle, metadata, and README.
              </p>
            </motion.div>
          )}

          <AnimatePresence initial={false}>
            {messages.map((m) => (
              <motion.div
                key={m.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className={`flex gap-3 ${m.role === "user" ? "flex-row-reverse" : ""}`}
              >
                <div
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border text-xs font-mono font-bold ${
                    m.role === "user"
                      ? "border-[#333] bg-white text-black"
                      : "border-[#222] bg-[#111] text-white"
                  }`}
                >
                  {m.role === "user" ? "U" : "AI"}
                </div>
                <div
                  className={`min-w-0 max-w-[85%] rounded-xl border px-4 py-3 ${
                    m.role === "user"
                      ? "border-[#222] bg-[#111] text-neutral-200"
                      : "border-[#222] bg-black text-neutral-200"
                  }`}
                >
                  {m.role === "assistant" ? (
                    <MarkdownMessage content={m.content} />
                  ) : (
                    <pre className="whitespace-pre-wrap font-mono text-sm text-neutral-200">{m.content}</pre>
                  )}
                  {m.role === "assistant" && !isLoading && m.id === lastAssistant?.id && (
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-[#222] pt-3">
                      <button
                        type="button"
                        onClick={() => reload()}
                        className="rounded-lg border border-[#333] px-3 py-1.5 text-xs font-mono text-neutral-300 hover:border-white hover:text-white transition-colors"
                      >
                        Regenerate
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          append({
                            role: "user",
                            content:
                              "Explain the code you just generated: main classes, registration flow, and how to build/run.",
                          })
                        }
                        className="rounded-lg border border-[#333] px-3 py-1.5 text-xs font-mono text-neutral-300 hover:border-white hover:text-white transition-colors"
                      >
                        Explain code
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          append({
                            role: "user",
                            content:
                              "AI Debug Mode: review the project for common Minecraft modding mistakes (wrong registry usage, client/server separation, thread safety). List issues briefly. If you fix code, output only **complete** replacement files using CodexMC fences (language + full path per file)—no partial snippets or ellipses.",
                          })
                        }
                        className="rounded-lg border border-[#333] px-3 py-1.5 text-xs font-mono text-neutral-300 hover:border-white hover:text-white transition-colors"
                      >
                        AI Debug
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          append({
                            role: "user",
                            content:
                              "Add feature: one focused enhancement that fits the existing project. Return a **complete** updated project: full file tree plus every touched file in full (same CodexMC code-block format). No TODOs or stubs for the new behavior.",
                          })
                        }
                        className="rounded-lg border border-[#333] px-3 py-1.5 text-xs font-mono text-neutral-300 hover:border-white hover:text-white transition-colors"
                      >
                        Add feature
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>
            ))}
          </AnimatePresence>

          {isLoading && (
            <div className="flex gap-3">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-[#222] bg-[#111] text-xs font-mono text-white">
                AI
              </div>
              <div className="rounded-xl border border-[#222] bg-black px-4 py-3">
                <div className="flex gap-1">
                  {[0, 1, 2].map((i) => (
                    <motion.span
                      key={i}
                      className="h-2 w-2 rounded-full bg-neutral-500"
                      animate={{ opacity: [0.3, 1, 0.3] }}
                      transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }}
                    />
                  ))}
                </div>
                <p className="mt-2 text-xs text-neutral-500 font-mono">Streaming from OpenRouter…</p>
              </div>
            </div>
          )}

          {error && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/30 px-4 py-3 text-sm text-red-200 font-mono">
              {error.message}
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {lastAssistant && (
        <div className="border-t border-[#222] bg-[#050505] px-4 py-4 md:px-8 max-h-[40vh] overflow-y-auto">
          <div className="mx-auto max-w-5xl flex flex-col gap-2 mb-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] uppercase tracking-widest text-neutral-500 font-mono mr-1">Export</span>
              <button
                type="button"
                onClick={() => downloadExport(false)}
                className="rounded-lg border border-[#333] px-3 py-1.5 text-xs font-mono text-neutral-200 hover:border-white hover:text-white transition-colors"
              >
                Download project (ZIP)
              </button>
              <button
                type="button"
                disabled={jarBuilding}
                onClick={() => void downloadBuiltJar()}
                className="rounded-lg border border-white/30 bg-white/5 px-3 py-1.5 text-xs font-mono text-white hover:bg-white/10 transition-colors disabled:opacity-40 disabled:cursor-wait"
              >
                {jarBuilding ? "Building JAR…" : "Build & download JAR"}
              </button>
              <button
                type="button"
                onClick={() => downloadExport(true)}
                className="rounded-lg border border-[#333] px-3 py-1.5 text-[10px] font-mono text-neutral-500 hover:text-neutral-300"
              >
                ZIP + local how-to
              </button>
            </div>
            {exportHint && (
              <p
                className={`text-[10px] font-mono max-w-3xl ${
                  exportHint.startsWith("Built on") ? "text-neutral-300" : "text-neutral-400"
                }`}
              >
                {exportHint}
              </p>
            )}
            <p className="text-[10px] text-neutral-500 font-mono leading-relaxed max-w-2xl">
              <strong className="text-neutral-400">Build &amp; download JAR</strong> runs Gradle on the CodexMC server (needs{" "}
              <code className="text-neutral-400">CODEXMC_ENABLE_SERVER_BUILD=true</code> and JDK 17/21). On failure, the server may
              ask the AI to repair Gradle/sources and retry. <strong className="text-neutral-400">ZIP + local how-to</strong> is for
              building on your own PC.
            </p>
          </div>
          <p className="text-[10px] uppercase tracking-widest text-neutral-500 font-mono mb-2">File preview</p>
          <div className="mx-auto max-w-5xl">
            <CodeOutput
              content={lastAssistant.content}
              isStreaming={isLoading}
              mcVersion={chat.mcVersion}
              loader={chat.projectKind === "plugin" ? "Paper" : chat.loader}
            />
          </div>
        </div>
      )}

      <div className="border-t border-[#222] bg-black px-4 py-4 md:px-8">
        <form
          onSubmit={(e) => {
            handleSubmit(e);
          }}
          className="mx-auto max-w-3xl"
        >
          <div className="rounded-xl border border-[#222] bg-[#0a0a0a] focus-within:border-neutral-600 transition-colors">
            <textarea
              value={input}
              onChange={handleInputChange}
              rows={4}
              placeholder="Describe your mod or plugin… (Enter to send, Shift+Enter for newline)"
              className="w-full resize-none bg-transparent px-4 py-3 text-sm font-mono text-neutral-100 placeholder:text-neutral-600 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key !== "Enter" || e.shiftKey) return;
                e.preventDefault();
                if (isLoading || !input.trim()) return;
                handleSubmit(e as unknown as React.FormEvent<HTMLFormElement>);
              }}
            />
            <div className="flex items-center justify-between border-t border-[#222] px-3 py-2">
              <span className="text-[10px] text-neutral-600 font-mono">Enter send · Shift+Enter newline · OpenRouter</span>
              <div className="flex gap-2">
                {isLoading && (
                  <button
                    type="button"
                    onClick={() => stop()}
                    className="rounded-lg border border-[#333] px-3 py-1.5 text-xs font-mono text-neutral-300 hover:text-white"
                  >
                    Stop
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isLoading || !input.trim()}
                  className="rounded-lg bg-white px-4 py-1.5 text-xs font-mono font-semibold text-black hover:bg-neutral-200 disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function Studio() {
  const [chats, setChats] = useState<StoredChat[]>([]);
  const [active, setActive] = useState<StoredChat>(() => newClientChat());
  const [hydrated, setHydrated] = useState(false);
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const refreshList = useCallback(async () => {
    const res = await fetch("/api/chats");
    const data = await res.json();
    setChats(data.chats || []);
    return data.chats as StoredChat[];
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      let serverReady = false;
      try {
        const list = await refreshList();
        if (cancelled) return;
        if (list?.length) {
          setActive(list[0]);
          serverReady = true;
        } else {
          const res = await fetch("/api/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          const data = await res.json();
          if (!cancelled && data.chat) {
            setChats([data.chat]);
            setActive(data.chat);
            serverReady = true;
          }
        }
      } catch {
        try {
          const res = await fetch("/api/chats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          });
          const data = await res.json();
          if (!cancelled && data.chat) {
            setChats([data.chat]);
            setActive(data.chat);
            serverReady = true;
          }
        } catch {
          /* keep client default chat; persist stays off until API works */
        }
      } finally {
        if (!cancelled) setHydrated(serverReady);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshList]);

  const selectChat = async (id: string) => {
    const res = await fetch(`/api/chats/${id}`);
    if (!res.ok) return;
    const { chat } = await res.json();
    setActive(chat);
    setHydrated(true);
  };

  const persistMeta = useCallback(async (patch: Partial<StoredChat>) => {
    if (!active || !hydrated) return;
    const res = await fetch(`/api/chats/${active.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return;
    const { chat } = await res.json();
    setActive(chat);
    setChats((prev) => {
      const i = prev.findIndex((c) => c.id === chat.id);
      if (i === -1) return [chat, ...prev];
      const next = [...prev];
      next[i] = chat;
      return next.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
    });
  }, [active, hydrated]);

  const newChat = async () => {
    const res = await fetch("/api/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    const { chat } = await res.json();
    setChats((c) => [chat, ...c]);
    setActive(chat);
    setHydrated(true);
  };

  const deleteChatById = async (id: string) => {
    const wasActive = active?.id === id;
    await fetch(`/api/chats/${id}`, { method: "DELETE" });
    const list = await refreshList();
    setChats(list);
    if (!wasActive) return;
    if (list.length) {
      const res = await fetch(`/api/chats/${list[0].id}`);
      const { chat } = await res.json();
      setActive(chat);
      setHydrated(true);
    } else {
      const res = await fetch("/api/chats", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const data = await res.json();
      setChats([data.chat]);
      setActive(data.chat);
      setHydrated(true);
    }
  };

  const commitRename = async (id: string) => {
    const title = renameValue.trim() || "Untitled";
    await fetch(`/api/chats/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title }),
    });
    setRenameId(null);
    await refreshList();
    if (active?.id === id) {
      const res = await fetch(`/api/chats/${id}`);
      const { chat } = await res.json();
      setActive(chat);
    }
  };

  const updateMeta = (patch: Partial<StoredChat>) => {
    if (!active) return;
    const next = { ...active, ...patch };
    setActive(next);
    persistMeta(patch);
  };

  const sidebarChats = chats.length > 0 ? chats : [active];

  return (
    <div className="flex h-screen bg-black text-white overflow-hidden">
      <motion.aside
        initial={false}
        className="flex w-72 shrink-0 flex-col border-r border-[#222] bg-[#111]"
      >
        <div className="border-b border-[#222] p-4">
          <button
            type="button"
            onClick={newChat}
            className="w-full rounded-lg bg-white py-2 text-xs font-mono font-semibold text-black hover:bg-neutral-200"
          >
            + New project
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {sidebarChats.map((c) => (
            <div key={c.id} className="group rounded-lg border border-transparent hover:border-[#333]">
              {renameId === c.id ? (
                <input
                  autoFocus
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={() => commitRename(c.id)}
                  onKeyDown={(e) => e.key === "Enter" && commitRename(c.id)}
                  className="w-full bg-[#0a0a0a] border border-[#333] rounded px-2 py-2 text-xs font-mono text-white"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => selectChat(c.id)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono transition-colors ${
                    active.id === c.id ? "bg-[#1a1a1a] text-white" : "text-neutral-400 hover:text-white"
                  }`}
                >
                  <span className="line-clamp-2">{c.title}</span>
                  <span className="block text-[10px] text-neutral-600 mt-1">
                    {c.projectKind === "plugin" ? "Paper" : c.loader} · {c.mcVersion}
                  </span>
                </button>
              )}
              <div className="flex gap-1 px-2 pb-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  type="button"
                  className="text-[10px] text-neutral-500 hover:text-white font-mono"
                  onClick={() => {
                    setRenameId(c.id);
                    setRenameValue(c.title);
                  }}
                >
                  rename
                </button>
                <button
                  type="button"
                  className="text-[10px] text-red-400 hover:text-red-300 font-mono"
                  onClick={() => deleteChatById(c.id)}
                >
                  delete
                </button>
              </div>
            </div>
          ))}
        </div>
      </motion.aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-[#222] bg-[#0a0a0a] px-4 py-3 md:px-6">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono font-bold tracking-tight truncate">CodexMC</span>
            <span className="text-[10px] text-neutral-600 font-mono hidden sm:inline">studio</span>
          </div>
          <div className="flex flex-wrap gap-2 ml-auto items-center">
            <select
              value={active.projectKind}
              onChange={(e) => {
                const projectKind = e.target.value as StoredChat["projectKind"];
                if (projectKind === "plugin") {
                  const mcVersion = pickMcVersionForLoader("plugin", "Paper", active.mcVersion);
                  updateMeta({ projectKind, loader: "Paper", mcVersion });
                } else {
                  const loader = (LOADERS_MOD as readonly string[]).includes(active.loader)
                    ? active.loader
                    : "Fabric";
                  const mcVersion = pickMcVersionForLoader("mod", loader, active.mcVersion);
                  updateMeta({ projectKind, loader, mcVersion });
                }
              }}
              className="rounded-md border border-[#222] bg-black px-2 py-1.5 text-[11px] font-mono text-neutral-200"
            >
              <option value="mod">Mod (Fabric/Forge)</option>
              <option value="plugin">Paper / Spigot plugin</option>
            </select>
            <select
              value={active.generationMode}
              onChange={(e) => updateMeta({ generationMode: e.target.value as StoredChat["generationMode"] })}
              className="rounded-md border border-[#222] bg-black px-2 py-1.5 text-[11px] font-mono text-neutral-200"
            >
              <option value="simple">Simple</option>
              <option value="advanced">Advanced</option>
            </select>
            {active.projectKind === "mod" ? (
              <select
                value={active.loader}
                onChange={(e) => {
                  const loader = e.target.value;
                  const mcVersion = pickMcVersionForLoader("mod", loader, active.mcVersion);
                  updateMeta({ loader, mcVersion });
                }}
                className="rounded-md border border-[#222] bg-black px-2 py-1.5 text-[11px] font-mono text-neutral-200"
              >
                {LOADERS_MOD.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-[11px] font-mono text-neutral-500 px-2">Paper API</span>
            )}
            <select
              value={active.mcVersion}
              onChange={(e) => updateMeta({ mcVersion: e.target.value })}
              className="rounded-md border border-[#222] bg-black px-2 py-1.5 text-[11px] font-mono text-neutral-200 min-w-[7.5rem]"
            >
              {mcVersionsFor(active.projectKind, active.projectKind === "plugin" ? "Paper" : active.loader).map((v) => (
                <option key={v} value={v}>
                  MC {v}
                </option>
              ))}
            </select>
          </div>
        </header>

        <StudioSession
          key={active.id}
          chat={active}
          onPersisted={refreshList}
          persistEnabled={hydrated}
        />
      </div>
    </div>
  );
}
