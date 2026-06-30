'use client';

import Dexie, { type Table } from 'dexie';
import type { LocalMessage, Conversation, User } from '@/types';

export class ZapChatDB extends Dexie {
  messages!: Table<LocalMessage, string>;
  conversations!: Table<Conversation, string>;
  contacts!: Table<User, string>;
  keyStore!: Table<{ id: string; data: string }, string>;
  pendingQueue!: Table<{ id: string; conversationId: string; payload: string; createdAt: string }, string>;

  constructor() {
    super('ZapChatDB');

    this.version(1).stores({
      messages:      'localId, conversationId, senderId, timestamp, [conversationId+timestamp], status',
      conversations: 'id, type, updated_at, other_user_id',
      contacts:      'id, username, email',
      keyStore:      'id',
      pendingQueue:  'id, conversationId, createdAt',
    });
  }
}

let _db: ZapChatDB | null = null;

export function getDB(): ZapChatDB {
  if (!_db) _db = new ZapChatDB();
  return _db;
}

/* ── Message operations ── */
export async function saveMessage(msg: LocalMessage): Promise<void> {
  try {
    await getDB().messages.add(msg);
  } catch {
    // ConstraintError: message already in IndexedDB — preserve existing status
  }
}

export async function saveMessages(msgs: LocalMessage[]): Promise<void> {
  await getDB().messages.bulkPut(msgs);
}

export async function getMessages(conversationId: string, limit = 50, before?: string): Promise<LocalMessage[]> {
  const db = getDB();
  let query = db.messages
    .where('[conversationId+timestamp]')
    .between([conversationId, Dexie.minKey], [conversationId, before ?? Dexie.maxKey]);

  const results = await query.reverse().limit(limit).toArray();
  return results.reverse();
}

export async function getLastMessage(conversationId: string): Promise<LocalMessage | undefined> {
  const results = await getDB().messages
    .where('[conversationId+timestamp]')
    .between([conversationId, Dexie.minKey], [conversationId, Dexie.maxKey])
    .reverse()
    .limit(1)
    .toArray();
  return results[0];
}

export async function updateMessageStatus(localId: string, status: LocalMessage['status'], extra?: Partial<LocalMessage>): Promise<void> {
  await getDB().messages.where('localId').equals(localId).modify({ status, ...extra });
}

export async function deleteMessageForMe(localId: string): Promise<void> {
  await getDB().messages.where('localId').equals(localId).modify({ deletedForMe: true });
}

export async function deleteMessageForEveryone(localId: string): Promise<void> {
  await getDB().messages.where('localId').equals(localId).modify({
    deletedForEveryone: true,
    text: undefined,
    mediaUrl: undefined,
  });
}

export async function updateMessageReaction(localId: string, userId: string, emoji: string | null): Promise<void> {
  const msg = await getDB().messages.get(localId);
  if (!msg) return;
  const reactions = msg.reactions.filter(r => r.userId !== userId);
  if (emoji) reactions.push({ userId, emoji });
  await getDB().messages.update(localId, { reactions });
}

export async function getUnreadCount(conversationId: string, lastReadAt: string): Promise<number> {
  return getDB().messages
    .where('[conversationId+timestamp]')
    .between([conversationId, lastReadAt], [conversationId, Dexie.maxKey], false, true)
    .filter(m => !m.isMine && !m.deletedForMe)
    .count();
}

export async function searchMessages(conversationId: string, text: string): Promise<LocalMessage[]> {
  return getDB().messages
    .where('conversationId').equals(conversationId)
    .filter(m => !!m.text && m.text.toLowerCase().includes(text.toLowerCase()))
    .toArray();
}

/* ── Conversation operations ── */
export async function saveConversation(conv: Conversation): Promise<void> {
  await getDB().conversations.put(conv);
}

export async function saveConversations(convs: Conversation[]): Promise<void> {
  await getDB().conversations.bulkPut(convs);
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  return getDB().conversations.get(id);
}

export async function getAllConversations(): Promise<Conversation[]> {
  return getDB().conversations.orderBy('updated_at').reverse().toArray();
}

/* ── Contact operations ── */
export async function saveContact(user: User): Promise<void> {
  await getDB().contacts.put(user);
}

export async function getContact(id: string): Promise<User | undefined> {
  return getDB().contacts.get(id);
}

/* ── Key store (crypto keys) ── */
export async function storeKey(id: string, data: string): Promise<void> {
  await getDB().keyStore.put({ id, data });
}

export async function retrieveKey(id: string): Promise<string | undefined> {
  const entry = await getDB().keyStore.get(id);
  return entry?.data;
}

/* ── Offline queue ── */
export async function enqueueMessage(id: string, conversationId: string, payload: string): Promise<void> {
  await getDB().pendingQueue.put({ id, conversationId, payload, createdAt: new Date().toISOString() });
}

export async function dequeueMessage(id: string): Promise<void> {
  await getDB().pendingQueue.delete(id);
}

export async function getPendingQueue() {
  return getDB().pendingQueue.orderBy('createdAt').toArray();
}

/* ── Clear conversation data ── */
export async function clearConversationMessages(conversationId: string): Promise<void> {
  await getDB().messages.where('conversationId').equals(conversationId).delete();
}

/* ── Wipe all user data (call on logout / user switch to prevent data leaks) ── */
export async function clearAllUserData(): Promise<void> {
  const db = getDB();
  await db.transaction('rw', db.messages, db.conversations, db.contacts, db.pendingQueue, async () => {
    await db.messages.clear();
    await db.conversations.clear();
    await db.contacts.clear();
    await db.pendingQueue.clear();
    // Keep keyStore — keys survive logout so user doesn't need to re-generate on next login
  });
}
