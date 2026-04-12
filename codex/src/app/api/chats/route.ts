import { NextResponse } from "next/server";
import { createChat, listChats } from "@/lib/chat-store";

export async function GET() {
  const chats = await listChats();
  return NextResponse.json({ chats });
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const chat = await createChat(body);
  return NextResponse.json({ chat });
}
