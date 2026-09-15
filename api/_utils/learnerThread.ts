/**
 * learnerThread — a learner's reply to an admin message (job #821).
 *
 * "Once they message support then the channel becomes live" (Tom,
 * 2026-09-15). A reply to an admin_message inbox row opens a support thread
 * OWNED BY THE LEARNER: support_threads.learner_user_id + origin_message_id,
 * one thread per learner-message pair. The reply itself is an ordinary
 * support_messages 'in' row, so it reaches the support_inbox view and the
 * watson-1 watcher cards it to Tom like a school admin's question. His reply
 * is an 'out' row; the fan-out trigger clears read_at on the origin message so
 * the learner's inbox shows it unread again with the reply inside.
 *
 * Nothing here is reachable except through the learner's own message: the
 * origin row must be theirs (own-row read) and must be an admin_message.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { UserMessageRow } from './userMessages'

export const REPLY_MAX = 2000

export interface LearnerThreadRow {
  id: string
  learner_user_id: string
  origin_message_id: string
  last_message_at: string | null
  last_read_at: string | null
}

export interface ThreadTurn {
  id: string
  body: string
  direction: 'in' | 'out'
  author_name: string | null
  created_at: string
}

export const TURN_COLUMNS = 'id, body, direction, author_name, created_at'

export async function findLearnerThread(svc: SupabaseClient, userId: string, originMessageId: string): Promise<LearnerThreadRow | null> {
  const { data, error } = await svc
    .from('support_threads')
    .select('id, learner_user_id, origin_message_id, last_message_at, last_read_at')
    .eq('learner_user_id', userId)
    .eq('origin_message_id', originMessageId)
    .maybeSingle()
  if (error) throw new Error(`support thread lookup failed: ${error.message}`)
  return (data as LearnerThreadRow | null) ?? null
}

export async function getOrCreateLearnerThread(svc: SupabaseClient, userId: string, originMessageId: string): Promise<LearnerThreadRow> {
  const existing = await findLearnerThread(svc, userId, originMessageId)
  if (existing) return existing
  const { data, error } = await svc
    .from('support_threads')
    .insert({ learner_user_id: userId, origin_message_id: originMessageId, language: 'eng' })
    .select('id, learner_user_id, origin_message_id, last_message_at, last_read_at')
    .single()
  if (error || !data) {
    // A concurrent first reply may have won the unique index; read it back.
    const again = await findLearnerThread(svc, userId, originMessageId)
    if (again) return again
    throw new Error(error?.message || 'support thread could not be created')
  }
  return data as LearnerThreadRow
}

export async function listTurns(svc: SupabaseClient, threadId: string): Promise<ThreadTurn[]> {
  const { data, error } = await svc.from('support_messages').select(TURN_COLUMNS).eq('thread_id', threadId).order('created_at', { ascending: true })
  if (error) throw new Error(`support messages read failed: ${error.message}`)
  return (data ?? []) as ThreadTurn[]
}

export interface ReplyClientEnvelope {
  route?: string
  build_version?: string
  device_info?: { userAgent?: string; screen?: string; language?: string }
}

/** Write the learner's turn. Returns the thread and the row as the inbox renders it. */
export async function postLearnerReply(
  svc: SupabaseClient,
  origin: UserMessageRow,
  text: string,
  client: ReplyClientEnvelope,
): Promise<{ thread: LearnerThreadRow; turn: ThreadTurn }> {
  const thread = await getOrCreateLearnerThread(svc, origin.recipient_user_id, origin.id)
  const { data: learner } = await svc.from('learners').select('id, display_name').eq('user_id', origin.recipient_user_id).maybeSingle()
  const l = learner as { id?: string; display_name?: string } | null
  const { data, error } = await svc
    .from('support_messages')
    .insert({
      thread_id: thread.id,
      body: text,
      direction: 'in',
      author_source: 'human',
      author_name: l?.display_name ?? null,
      author_via: 'jwt',
      author_user_id: origin.recipient_user_id,
      envelope: {
        client,
        server: {
          kind: 'learner_reply',
          learner_id: l?.id ?? null,
          origin: { message_id: origin.id, title: origin.title, body: origin.body.slice(0, 280), dedupe_key: origin.dedupe_key },
        },
      },
    })
    .select(TURN_COLUMNS)
    .single()
  if (error || !data) throw new Error(error?.message || 'reply could not be saved')
  const now = new Date().toISOString()
  await svc.from('support_threads').update({ last_message_at: now, last_read_at: now }).eq('id', thread.id)
  return { thread, turn: data as ThreadTurn }
}
