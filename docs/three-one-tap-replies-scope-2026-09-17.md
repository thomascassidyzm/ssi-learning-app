# Can the inbox carry three one-tap replies? Mostly, yes — and the gap was one action kind

Read of `api/messages/act.ts`, `api/messages/reply.ts`, `api/_utils/userMessages.ts`,
`packages/player-vue/src/components/messages/UserMessageList.vue`,
`composables/useUserMessages.ts`, and migrations `20260914e`, `20260915b`, `20260915c`.

## What the code actually says

`user_messages.action` is a single `jsonb` object with `kind`, `label` and `payload`, and
`action_taken_at` is a single `timestamptz`. `act.ts` runs the one action and refuses a
second run with 409. `UserMessageList.vue` renders exactly one button from `m.action`. So
the brief's outside read was right about the shape: the path cannot carry three *actions*.

But it does not need to, because two of the three replies are not actions.

- **Reply to the team** already exists, twice over. `open_support` is a live action kind
  that runs nothing server-side and lets the client navigate, and independently every
  message whose source is `admin_message` already renders a free-text reply box that opens
  a learner-owned support thread and cards to Tom. Cost to add: nothing.
- **Show me** already exists as prose. An `admin_message` body is rendered through
  `renderMarkdownLight`, which auto-links any bare http(s) URL into a real anchor. A link to
  `/schools/handbook?entry=play-as-class-from-the-class-page` opens the Handbook at that
  entry, which since job #302 offers the clip and defers the walk to the class page. Cost to
  add: nothing, though it opens in a new tab because the renderer sets `target="_blank"`.
- **Understood** did not exist. `read_at` is stamped when the message is opened, which is an
  impression rather than an answer, and there was no kind that simply says "yes, got it".

## What was built

One new action kind, `acknowledge`: it stamps `action_taken_at`, answers 200, and runs
nothing else. A second tap gets the same 409 every other kind gets, which is right — an
acknowledgement is given once. The client needed no change at all beyond the type union:
`actionWords()` already falls through to the server-supplied label, and `runAction()`
already calls `act` for any kind that is not `open_support`.

Four files, about fifteen lines of behaviour, no migration, no new column, no new endpoint,
no one-to-many change to `action`. `api/messages/act.acknowledge.test.ts` pins the stamp and
the 409; it failed twice on the pre-change code and passes on the post-change code, and I
saw it do both.

## Better × Simpler × Cheaper

- **Better.** Tom finds out whether the note landed, from a tap rather than from an
  inference about `read_at`. Every future admin message can ask the same question.
- **Simpler.** It adds one member to an existing enum and changes no shape anywhere. It is
  strictly simpler than the change the brief anticipated — making `action` a list, with two
  new kinds and a button row — because it declines to build the two affordances the codebase
  already had. Nothing becomes polymorphic, so nobody reading `row.action` later has to ask
  whether it might be an array.
- **Cheaper.** No migration, no table, no endpoint, no client restructure; one test file.

## What is deliberately not built

A one-to-many `action`. If a message ever genuinely needs two *stamping* actions at once,
that is the day to build it, and `action_taken_at` would have to become per-action at the
same time. Nothing in this note needs it: the three replies are three alternative answers to
one question, and one stamp is the honest record of that.
