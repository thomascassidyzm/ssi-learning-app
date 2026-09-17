/**
 * userMessages — the in-app message inbox primitive, server side (job #684).
 *
 * ONE message primitive per user (Tom, 2026-09-14: "we DO want to be able to
 * send them in-app messages about stuff like this"): a source, a REAL read
 * state, and an optional one-tap action. Rows live in public.user_messages,
 * keyed on the recipient's auth uid; the schools inbox and the learner inbox
 * are two renderings of the same rows.
 *
 * THE BAR FOR SENDING (Tom's policy line, verbatim): "the bar for sending a
 * learner anything is whether it changes what they would do, or the inbox
 * becomes the tab nobody opens." Before adding a source, write the sentence
 * that says what the recipient will DO differently for having read it. If it
 * will not write, do not send.
 *
 * READ STATE IS REAL. "Delivered is not seen." Nothing here stamps read_at:
 * listing a message never marks it read; only POST /api/messages/read (the
 * person tapped it) or opening the content it points at does.
 *
 * IDEMPOTENT SENDS. A dedupeKey makes a sender safe to call twice: the copy
 * sweep and its backfill, the support trigger, a retried request — none can
 * double-send. A repeat with the same key is a no-op that reports sent:false.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export const USER_MESSAGES_TABLE = 'user_messages'

export type UserMessageSource = 'support_reply' | 'class_play_copied' | 'admin_message'

export type UserMessageActionKind = 'undo_class_play_copy' | 'open_support' | 'acknowledge'

export interface UserMessageAction {
  kind: UserMessageActionKind
  /** The button's words, in the recipient's language, plain. */
  label: string
  payload: Record<string, unknown>
}

export interface UserMessageRow {
  id: string
  recipient_user_id: string
  source: UserMessageSource
  title: string
  body: string
  action: UserMessageAction | null
  action_taken_at: string | null
  read_at: string | null
  dismissed_at: string | null
  created_at: string
  dedupe_key: string | null
}

/** What the client sees: the row minus the recipient (it is theirs by construction) and the dedupe key. */
export interface UserMessageView {
  id: string
  source: UserMessageSource
  title: string
  body: string
  action: { kind: UserMessageActionKind; label: string } | null
  action_taken_at: string | null
  read_at: string | null
  dismissed_at: string | null
  created_at: string
}

export const MESSAGE_COLUMNS =
  'id, recipient_user_id, source, title, body, action, action_taken_at, read_at, dismissed_at, created_at, dedupe_key'

export function toView(row: UserMessageRow): UserMessageView {
  return {
    id: row.id,
    source: row.source,
    title: row.title,
    body: row.body,
    action: row.action ? { kind: row.action.kind, label: row.action.label } : null,
    action_taken_at: row.action_taken_at,
    read_at: row.read_at,
    dismissed_at: row.dismissed_at,
    created_at: row.created_at,
  }
}

export interface SendUserMessageInput {
  /** auth uid (learners.user_id) of the person who will read it. */
  recipientUserId: string
  source: UserMessageSource
  title: string
  body: string
  action?: UserMessageAction
  /** Idempotency key; a repeat send with the same key is a no-op. */
  dedupeKey?: string
}

export interface SendUserMessageResult {
  /** True when a NEW row landed; false when the dedupe key already existed. */
  sent: boolean
  id: string | null
  error?: string
}

/**
 * Send one message. Service-role client only — the table accepts no client
 * inserts. Never throws: a failed send is reported, and the caller decides
 * whether the surrounding action (a copy, a reply) still counts as done.
 */
export async function sendUserMessage(svc: SupabaseClient, input: SendUserMessageInput): Promise<SendUserMessageResult> {
  const row = {
    recipient_user_id: input.recipientUserId,
    source: input.source,
    title: input.title,
    body: input.body,
    action: input.action ?? null,
    dedupe_key: input.dedupeKey ?? null,
  }
  const q = input.dedupeKey
    ? svc.from(USER_MESSAGES_TABLE).upsert(row, { onConflict: 'dedupe_key', ignoreDuplicates: true })
    : svc.from(USER_MESSAGES_TABLE).insert(row)
  const { data, error } = await q.select('id')
  if (error) return { sent: false, id: null, error: error.message }
  const rows = (data ?? []) as Array<{ id: string }>
  if (rows.length === 0) return { sent: false, id: null }
  return { sent: true, id: String(rows[0].id) }
}

/** Newest first, capped. Never marks anything read. */
export async function listUserMessages(svc: SupabaseClient, recipientUserId: string, limit = 100): Promise<UserMessageRow[]> {
  const { data, error } = await svc
    .from(USER_MESSAGES_TABLE)
    .select(MESSAGE_COLUMNS)
    .eq('recipient_user_id', recipientUserId)
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`${USER_MESSAGES_TABLE} read failed: ${error.message}`)
  return (data ?? []) as unknown as UserMessageRow[]
}

export function unreadCount(rows: UserMessageRow[]): number {
  return rows.filter((r) => !r.read_at).length
}

/** One message, only if it is the caller's own. Null otherwise — a foreign id reads as absent, never as forbidden. */
export async function ownUserMessage(svc: SupabaseClient, recipientUserId: string, id: string): Promise<UserMessageRow | null> {
  const { data, error } = await svc
    .from(USER_MESSAGES_TABLE)
    .select(MESSAGE_COLUMNS)
    .eq('id', id)
    .eq('recipient_user_id', recipientUserId)
    .maybeSingle()
  if (error) throw new Error(`${USER_MESSAGES_TABLE} read failed: ${error.message}`)
  return (data as unknown as UserMessageRow | null) ?? null
}

/**
 * The person TAPPED it. Stamps read_at once; a second tap changes nothing.
 * Own-row by construction: the update is filtered on the recipient too.
 */
export async function markUserMessageRead(svc: SupabaseClient, recipientUserId: string, id: string): Promise<void> {
  const { error } = await svc
    .from(USER_MESSAGES_TABLE)
    .update({ read_at: new Date().toISOString() })
    .eq('id', id)
    .eq('recipient_user_id', recipientUserId)
    .is('read_at', null)
  if (error) throw new Error(`${USER_MESSAGES_TABLE} read-mark failed: ${error.message}`)
}

/**
 * Opening the Support thread IS reading its replies — the person tapped
 * Support and the reply is on the screen. Marks every unread support_reply
 * message of this recipient for this thread. Called by GET /api/support/thread
 * (not the peek), so the inbox never nags about a reply already read there.
 */
export async function markSupportRepliesRead(svc: SupabaseClient, recipientUserId: string, threadId: string): Promise<void> {
  const { error } = await svc
    .from(USER_MESSAGES_TABLE)
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_user_id', recipientUserId)
    .eq('source', 'support_reply')
    .is('read_at', null)
    .contains('action', { payload: { thread_id: threadId } })
  if (error) throw new Error(`${USER_MESSAGES_TABLE} support read-mark failed: ${error.message}`)
}
