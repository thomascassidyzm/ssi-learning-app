# Class stats: where the brain lives

Tap through: https://staging.saysomethingin.app/docs/specimens/class-stats/

## What is there today, read from the code

- **Overview** is the class node home, `views/admin/NodeHomeView.vue` at `/org/:classId`. Rail, identity header, Play as class, Manage class, the Overview | Insights pair, four numbers for the week, the Class practice card with this week's phrase table, the Course journey bar with "n more to Yellow belt", pupils' own accounts if any, then the class tools.
- **Insights** is `views/admin/NodeInsightsView.vue` at `/org/:classId/insights`. Same rail and header, the week card from `insight/NodeRateEngine.vue`: this class beside an average you choose, twelve weeks of bars, an all-time line. Under it, two folded lines: More about this level, which is the journey funnel, and Voice and pause.
- **The brain** is a static page at `/docs/specimens/replaying-brain/`, built by `docs/specimens/replaying-brain/build.mjs` from one class's play log. Arcs on a line, a replay scrubber, four totals, the phrases with hearing counts. Nothing in the app links to it yet on dev or staging.
- **Getting there.** The class row on My classes opens Overview on a tap anywhere and carries the same Overview | Insights pair. Both pages carry the pair in the header and the rail names the lens. That is the whole navigation.

The brain answers one question: how far into the course is this class and how well knit is what it has met. Overview already answers that question twice, as the "phrases travelled together" number and as the Course journey bar, and Insights answers it twice more, as the all-time "phrases reached" line and as the folded journey funnel. Four tellings of one fact across two pages is the thing to rationalise.

## The options

**A. Overview as today, the brain inside Insights.** Astra's position and what job #95 wires. Cheapest; no page changes shape. But Insights is the comparison lens, and Tom has ruled the brain carries no comparison. It puts the one non-comparative artefact on the comparison page, under a card that is all about the average, behind the fold, on a page a teacher opens less often than Overview.

**B. The brain is the Course journey.** Recommended. Overview's Course journey card becomes the brain at its latest frame, the four totals under it, one button to replay how it grew. The bar goes, because the brain is the bar drawn honestly. Insights stays the comparison lens, week card and voice, and loses the folded journey line on a class, since a funnel of one account is one number the brain already shows. Nothing new to navigate to, no new word, the pair and the row untouched.

**C. A third tab.** Rejected without a specimen. The brain is class only, so a third tab would be present on a class and absent on a school, which breaks "same control at every level". And it needs a new word, which the row ruling of 17 September closed.

## Why B

Overview is "this class, now". The brain is a portrait of this class with no comparison, which is Overview's grammar exactly and Insights' grammar not at all. A teacher who opens the class every lesson watches the ink reach further right; that is the glad-to-see-you moment, and it belongs on the page they open. B also deletes two things and adds none.

One taste call for Tom: in B the replay opens inline under the card. It could instead open the full brain page. Inline keeps the teacher on the class; I would keep it inline.

## What this means for job #95

Its first-light rule is right and is already on staging. Its wiring of the brain under Insights is option A. If Tom picks B, the implementation job moves that section to Overview's journey slot and drops the bar and the class-level journey fold. Nothing in this exploration touches its files.

## What is thin in the specimens

The class column, the phrases, the brain and the four totals are 9b/KW LJ's real play log. The school average on the Insights card is derived from the school's cycles at this class's minutes per cycle and is marked as such on the card. Teacher count, the updated stamp and the sparkline are dressing. Voice and pause, More about this level and Manage class are drawn as their folded lines only.
