const path = require('path');
const fs = require('fs-extra');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');

const DATA_DIR = path.resolve(config.workspace.dir, '_chat_store');
const CHATS_DIR = path.join(DATA_DIR, 'chats');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

function nowIso() {
  return new Date().toISOString();
}

function chatFile(chatId) {
  return path.join(CHATS_DIR, `${chatId}.json`);
}

async function ensureStore() {
  await fs.ensureDir(CHATS_DIR);
  if (!await fs.pathExists(INDEX_FILE)) {
    await fs.writeJson(INDEX_FILE, { chats: [] }, { spaces: 2 });
  }
}

async function readIndex() {
  await ensureStore();
  const raw = await fs.readJson(INDEX_FILE);
  return Array.isArray(raw?.chats) ? raw : { chats: [] };
}

async function writeIndex(index) {
  await ensureStore();
  await fs.writeJson(INDEX_FILE, index, { spaces: 2 });
}

async function readChat(chatId) {
  await ensureStore();
  const file = chatFile(chatId);
  if (!await fs.pathExists(file)) return null;
  return fs.readJson(file);
}

async function writeChat(chat) {
  await ensureStore();
  await fs.writeJson(chatFile(chat.id), chat, { spaces: 2 });
}

function summarizeTitle(input) {
  const text = (input || '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Untitled mod';
  return text.length > 48 ? `${text.slice(0, 48).trim()}...` : text;
}

function buildHistoryItem(chat) {
  const lastTurn = Array.isArray(chat.turns) && chat.turns.length > 0 ? chat.turns[chat.turns.length - 1] : null;
  return {
    id: chat.id,
    title: chat.title,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt,
    turnCount: chat.turns.length,
    lastPrompt: lastTurn?.prompt || '',
    lastModName: lastTurn?.result?.modName || lastTurn?.result?.modId || '',
  };
}

async function listChats() {
  const index = await readIndex();
  return index.chats
    .slice()
    .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
}

async function getChat(chatId) {
  const chat = await readChat(chatId);
  return chat || null;
}

async function appendTurn(chatId, turn) {
  await ensureStore();

  const timestamp = nowIso();
  let chat = chatId ? await readChat(chatId) : null;
  const isNew = !chat;

  if (!chat) {
    chat = {
      id: chatId || uuidv4(),
      title: summarizeTitle(turn.prompt || turn?.result?.modName),
      createdAt: timestamp,
      updatedAt: timestamp,
      turns: [],
    };
  }

  chat.turns.push({
    id: uuidv4(),
    createdAt: timestamp,
    prompt: turn.prompt || '',
    request: turn.request || {},
    result: turn.result || null,
    error: turn.error || null,
  });

  chat.updatedAt = timestamp;
  if (!chat.title || chat.title === 'Untitled mod') {
    chat.title = summarizeTitle(turn.prompt || turn?.result?.modName);
  }

  await writeChat(chat);

  const index = await readIndex();
  const item = buildHistoryItem(chat);
  const existing = index.chats.findIndex(entry => entry.id === chat.id);
  if (existing >= 0) index.chats[existing] = item;
  else index.chats.unshift(item);
  await writeIndex(index);

  return { chat, created: isNew };
}

module.exports = {
  ensureStore,
  listChats,
  getChat,
  appendTurn,
};
