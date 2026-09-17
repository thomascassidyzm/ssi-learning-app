/**
 * READY-TO-RUN, NOT YET RUN (job #77, follow-up to the 2026-09-17 send).
 *
 * Sends the Tom-approved note ("Starting a lesson on the class, not on you")
 * to leejames (St Alban's RC High School, Pontypool) and hughesr310 (Ysgol
 * Gyfun Tredegar) — the two teachers with proven evidence in
 * docs/teachers-teaching-from-own-account-2026-09-17.md.
 *
 * DO NOT RUN until AFTER the acknowledge action (this branch) has promoted
 * dev -> staging -> main through the normal weekly release train, so the
 * "Understood" button the recipient sees actually works in production. See
 * README.md next to this file for how and when to run it.
 *
 * Idempotent: each recipient gets a fresh random broadcast id, and
 * sendAdminMessage's dedupe_key means a second accidental run of this exact
 * script is a no-op for anyone already sent to under the SAME id — but since
 * this script mints a NEW id every run, re-running it deliberately sends
 * again. Run it once.
 */
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { sendAdminMessage } from '../../api/_utils/adminMessages'

const SB_URL = process.env.SB_URL
const SB_KEY = process.env.SB_KEY
if (!SB_URL || !SB_KEY) {
  console.error('Set SB_URL and SB_KEY (service role) before running. See README.md in this directory.')
  process.exit(1)
}
const svc = createClient(SB_URL, SB_KEY)

export const TITLE = 'Starting a lesson on the class, not on you'

export const BODY = `We have noticed that some of your lessons have been running while you were signed in as yourself rather than as the class. That is an easy thing to do, and nothing about it was obvious from the screen, so it is on us rather than on you.

It matters for one reason. The class has a brain of its own that decides what to practise next and when to bring a phrase back, and it can only see what happens on the class's own account. Everything you played while signed in as yourself is safely yours, but the class cannot learn from it, so the class is further back than the lessons you have actually taught.

The fix takes one tap from now on. Open the class and press **Play as class** rather than pressing play in your own library, and everything the class hears from then on lands on the class.

We are leaving what you have played exactly where it is. Nothing has been moved, nothing has been copied, and nothing you have done has been lost.

Show me: https://saysomethingin.app/schools/handbook?entry=play-as-class-from-the-class-page`

// Tom, platform_role ssi_admin — verified live 2026-09-17 (display_name "Tom").
const SENDER_USER_ID = 'ef65ea1f-57d0-4cf4-b744-33870c9449e8'

export const RECIPIENTS = [
  { name: 'leejames', userId: 'be35b6de-96d5-4900-b6b8-e6c4ab8360d9' },
  { name: 'hughesr310', userId: '1e94f8ac-b9c3-4094-8c22-605cb433a5f0' },
] as const

const ACTION = { kind: 'acknowledge', label: 'Understood', payload: {} }

for (const r of RECIPIENTS) {
  const id = randomUUID()
  const result = await sendAdminMessage(svc, {
    id,
    senderUserId: SENDER_USER_ID,
    spec: { kind: 'one', userId: r.userId },
    title: TITLE,
    body: BODY,
    action: ACTION,
  })
  console.log(r.name, JSON.stringify(result))
}
