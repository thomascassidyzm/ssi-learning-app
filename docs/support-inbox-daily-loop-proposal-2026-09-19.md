# Nothing should sit in the support inbox for four days

*A proposal, 19 September 2026. Written because Tom's own bug report sat
unanswered from 18 Sep 21:57 until this morning, and eleven genuine reports
from real testers had been sitting since April and May. Not built — this
names one recommendation and the reasons for it.*

---

## The hole, precisely

`api/cron/support-doorbell.ts` already runs hourly (`vercel.json`,
`20 * * * *`). It already holds everything a nag needs: the Resend path from
`contact.saysomethingin.app`, a deep link straight into the thread, per-reply
once-only sending via `doorbell_sent_at`, English and Welsh copy, and cron
auth that fails closed.

**It rings the wrong way round.** It fires when SSi has REPLIED and the school
has not opened it. Nothing anywhere fires when a school, a teacher or a
learner has ASKED and SSi has not replied. That is the whole gap. The inbox
reached 21 unanswered with no alarm of any kind, and the only reason it got
cleared today is that Tom happened to look at his phone.

Three postboxes feed that count, and today none of them is watched:

- `bug_reports` — the player's "Report a bug"
- `tester_feedback` — the older tester panel, still mounted and still written
- `support_messages` where `direction = 'in'` and `answered_at IS NULL` — the
  school and org threads

---

## The recommendation

**One new leg on the existing hourly cron, ringing SSi instead of the school.
Nothing else.**

Concretely: inside `support-doorbell.ts`, after the school leg, a second pass
that counts reports older than a threshold with no reply, and — at most once a
day — sends ONE email to SSi naming them, with a link into
`/admin/support`. A `rung_at` stamp per digest keeps it once-a-day the same
way `doorbell_sent_at` keeps the school leg once-a-reply.

**What it must do**

- Count all three postboxes, not just the threads.
- Ring only when the count is non-zero. A daily "0 waiting" email is how a
  nag becomes wallpaper.
- Name the oldest item and its age, because "3 waiting, oldest 4 days" is a
  different message from "3 waiting, oldest 40 minutes".
- Link into the admin inbox, where a human answers.
- Escalate by AGE, not by volume: one report four days old is worse than six
  from this morning.

**What it must never do**

- **Never write a reply.** Not a draft it sends, not a template, not an
  "acknowledged" holding line in SSi's voice. The reports cleared today needed
  a person to read the seed text, check the course table and say what was
  actually true; three of them turned out to be fixed or gone, two were real
  live content bugs, and a template would have told all eleven testers the same
  nothing. An auto-reply would have made the counter read zero and taught
  nobody anything — which is exactly the failure Tom named.
- **Never mark anything answered.** The count is the only honest signal there
  is; a loop that can clear its own alarm is not an alarm.
- Never email the learner or the school. This leg rings SSi, inward only.

## Better × simpler × cheaper

**Better.** It closes the actual hole rather than a nearby one. The four-day
silence happened because nobody was told, not because nobody could see — the
admin inbox has existed and been correct all along. A message that arrives
beats a page somebody has to remember to open.

**Simpler.** It is a second query and a second email inside a file that
already runs hourly, already has the mail path, already has the auth, already
has the once-only stamping pattern to copy. No new cron entry, no new secret,
no new surface, no new table. The alternative shapes are all strictly more
moving parts: a Command Surface job needs its own schedule, its own
credentials into production data, and its own place to fail silently; a new
cron path needs a `vercel.json` entry and duplicates the mail plumbing; a
dashboard badge needs somebody to already be looking, which is the thing that
did not happen.

**Cheaper.** One extra query per hour against tables with fewer than a hundred
rows, and at most one email a day. Nothing to run, nothing to host, nothing to
monitor. It deletes a recurring human cost — somebody remembering to check —
rather than adding one.

## The one thing to fix alongside it

Three of today's 21 could not be cleared at all: they are guest probe reports
with no `auth_user_id`, and `replyToLearnerReport` refuses them by design —
"this report was sent by a guest, so there is no inbox to reply to". They will
sit in the count for ever and drag the alarm down with them.

So the inbox needs **close without reply**: a way to mark a report dealt with
that does not pretend somebody was written to. Without it, either the new
alarm cries wolf every day over three e2e probes, or somebody fakes a reply to
silence it. One column and one button, and it should land in the same change
as the alarm rather than after it.

## Thresholds worth arguing about

Offered as a starting point, not a ruling:

- **Ring at 24 hours.** Long enough that an ordinary working day absorbs a
  report; short enough that four days is impossible.
- **Once a day, at most**, not hourly. The cron still runs hourly; the email
  is rate-limited by its own stamp.
- **Say the age of the oldest**, in the subject line: "3 reports waiting,
  oldest 4 days". A subject that carries the whole story does not need opening
  on a busy day.
