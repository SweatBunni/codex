import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";

export type StoredMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
};

export type StoredChat = {
  id: string;
  title: string;
  updatedAt: string;
  mcVersion: string;
  loader: string;
  projectKind: "mod" | "plugin";
  generationMode: "simple" | "advanced";
  messages: StoredMessage[];
};

const dataPath = () => path.join(process.cwd(), "data", "chats.json");

async function readDb(): Promise<Record<string, StoredChat>> {
  try {
    const raw = await fs.readFile(dataPath(), "utf-8");
    return JSON.parse(raw) as Record<string, StoredChat>;
  } catch {
    return {};
  }
}

async function writeDb(db: Record<string, StoredChat>): Promise<void> {
  await fs.mkdir(path.dirname(dataPath()), { recursive: true });
  await fs.writeFile(dataPath(), JSON.stringify(db, null, 2), "utf-8");
}

export async function listChats(): Promise<StoredChat[]> {
  const db = await readDb();
  return Object.values(db).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function getChat(id: string): Promise<StoredChat | null> {
  const db = await readDb();
  return db[id] ?? null;
}

export async function createChat(partial?: Partial<StoredChat>): Promise<StoredChat> {
  const db = await readDb();
  const id = randomUUID();
  const now = new Date().toISOString();
  const chat: StoredChat = {
    id,
    title: partial?.title ?? "New project",
    updatedAt: now,
    mcVersion: partial?.mcVersion ?? "1.20.1",
    loader: partial?.loader ?? "Fabric",
    projectKind: partial?.projectKind ?? "mod",
    generationMode: partial?.generationMode ?? "simple",
    messages: partial?.messages ?? [],
  };
  db[id] = chat;
  await writeDb(db);
  return chat;
}

export async function saveChat(chat: StoredChat): Promise<void> {
  const db = await readDb();
  db[chat.id] = { ...chat, updatedAt: new Date().toISOString() };
  await writeDb(db);
}

export async function patchChat(
  id: string,
  patch: Partial<Pick<StoredChat, "title" | "mcVersion" | "loader" | "projectKind" | "generationMode" | "messages">>
): Promise<StoredChat | null> {
  const db = await readDb();
  const cur = db[id];
  if (!cur) return null;
  const next: StoredChat = {
    ...cur,
    ...patch,
    id: cur.id,
    updatedAt: new Date().toISOString(),
  };
  db[id] = next;
  await writeDb(db);
  return next;
}

export async function deleteChat(id: string): Promise<boolean> {
  const db = await readDb();
  if (!db[id]) return false;
  delete db[id];
  await writeDb(db);
  return true;
}
