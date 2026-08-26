# Links

Hit the links!

A word game. Each hole gives you a **seed word** — its letters are the first letters of a
chain, and every neighbouring pair joins up: sometimes a true compound word (`OVERHEAD`),
sometimes a before-and-after pair (`PARTY ANIMAL`). The set uses both, in roughly even
measure. The first word is free; you fill in the rest.

```
SEED: SOFT
  S   SNAKE    (given)
  O   OIL      snake oil
  F   FIELD    oil field
  T   TRIP     field trip
```

Scoring is golf. A guess costs **1 stroke**; buying the next letter of the current word also
costs **1 stroke**. Every hole has a par (blanks + 1, or blanks + 2 for the long ones), and
there's no fail state — you always finish the hole, you just pay for it. Ten courses, three
holes each, 30 chains.

The game draws its own keyboard and has no text input anywhere, so a phone's OS keyboard
never opens over the board. The play screen is a fixed `100dvh` column — header, board,
keyboard — and nothing moves while you type. A physical keyboard works too, and lights up
the matching on-screen key.

Every row shares one column grid sized to the hole's longest word, so tiles are a uniform
size and each word's first letter stacks into a column. Read that column top to bottom and
it spells the seed.

**Master mode** (in settings) hides how many letters each word has. Unsolved rows show only
what you've earned or typed, and the input doesn't stop at the answer's length — otherwise
hitting the wall would tell you the length anyway.

Strokes shown in the header are **per hole** and reset at each tee; the scorecard adds them
up. Finishing a course offers a share card — a Wordle-style emoji grid where each square is
one word you filled in: 🟩 first guess, 🟨 needed another, 🟧 bought a letter, ⬛ bought the
whole word. It never shows an answer.

## Friends play

The **Club** tab shows today's round for you and everyone in your club, a crown on whoever
won, and a **Nudge** for anyone who hasn't played — which opens the phone's SMS composer with
one of ten canned messages ready, so nobody has to hand over a phone number.

Below that, a fortnight grid gives a column per day and a row per player, with a crown on each
day's winner. Tap any day to open it hole by hole: that day's leaderboard, then every hole
with each player's strokes and the best on each highlighted. Per-hole strokes are recovered
from the stored marks, since a guess and a bought letter each cost exactly one. A day's words
are only revealed to someone who has already played it, so drilling into a friend's round
can't hand you the answers.

Finishing a round ends with a quiet club strip: your score stays the headline, with a line
underneath saying where it put you.

Every device gets a 4-character friend code from an alphabet with no I, O, 0 or 1, so it
survives being read aloud over the phone. **That code is public** — you give it to friends so
they can add you. It therefore *addresses* a player and never *authenticates* one: writes
carry a 128-bit device token whose SHA-256 is all the server stores. Without that split,
anyone you had ever given your code to could file a round as you, and because the first
round of the day is the one that counts, it would stick.

Adding a friend is mutual and stored as a single row in a canonical order, so "A adds B" and
"B adds A" are the same fact and can't disagree.

Add an email under **You** and you can pick the account back up on another device with that
email plus your code. This is deliberately light: the code is public, so the email is the
only real secret. Sign-in is throttled per email in a rolling window and answers identically
whether the email is unknown, the code is wrong, or you're being throttled.

Play never waits on the network. Rounds are stored locally and the whole local history is
re-sent on each sync; the `(player, date)` primary key makes that idempotent, so there is no
outbox to lose or corrupt.

## Backend

Netlify DB (Postgres) behind Netlify Functions, routed at `/api/*`:

| Endpoint | Purpose |
|---|---|
| `POST /api/register` | Mint a player, a server-chosen code, and a device token |
| `POST /api/sync` | Hand over held rounds, get the club board back |
| `POST /api/friend` | Add a friend by their public code |
| `POST /api/claim` | Attach an email to this account |
| `POST /api/signin` | Adopt the account on another device |
| `GET /api/health` | Confirms a function can reach the database |

Schema lives in `netlify/database/migrations/` and is applied automatically on deploy. Run
the whole stack locally — static site, functions and a real local Postgres — with:

```bash
netlify dev
```

## The backroom

`links.superfun.games/backroom` is the admin — password `superfunlinks`, checked server-side
on every request. Four surfaces: **Overview** (players, rounds, shares, nudges, a 14-day
plays chart, completion rate), **Calendar** (every scheduled day with plays and average vs
par; tap a day for hole-by-hole difficulty and every round played), **Pool** (drafts,
upcoming days, and the unscheduled reserve), and an **Editor** that validates a new chain's
shape and checks each link against the vocabulary — known links show green, new ones yellow
so you say them out loud before saving.

New puzzles flow: Editor → drafts table → **Publish** button → Netlify build hook → the
build pulls approved drafts into the pool and reschedules. The game itself never changes
shape — it still ships the whole calendar in the page.

The scheduler freezes every published day into a `schedule_days` table at build time and
replays frozen days verbatim on later builds, so adding a draft can never reshuffle a date
somebody already played. The calendar rolls: each build schedules out to 24 days past today.

The game reports lightweight events — opens, round starts, practice starts, scorecard and
code shares, nudges, drill-downs — through a fire-and-forget beacon that gameplay never
waits on. Losing an event is always better than slowing the game.

## Running it



It's one self-contained `index.html` with no build step and no dependencies — open it, or
serve the folder:

```bash
python3 -m http.server 4399
```

Deployed on Netlify by publishing the repo root.

## Daily format

The main screen is **today's course** — five holes, the same for everyone, flipping at
midnight US Eastern so friends in different time zones compare the same puzzle. Past rounds
are listed below it and stay playable. Your **first completed round** for a date is the one
that counts; replays are welcome and clearly marked as not counting.

Difficulty follows a weekly rhythm. The number of full-length five-word holes climbs through
the week — 1 on Monday, 2 Tuesday and Wednesday, 3 Thursday, 4 Friday, 5 at the weekend — so
par runs from 18 on a Monday to 30 on a Sunday.

That quota is expensive: a five-word chain needs four strong links in a row with every initial
fixed in advance, so they are and will remain the scarce resource, and the length of the
calendar is set by how many exist. `build.mjs` flags any day it couldn't fill rather than
pretending the day is complete — if you see `!` in the build output, the vocabulary needs
widening before the calendar can grow.

## Editing puzzles

`puzzles.json` holds a flat pool of chains plus a `startDate`; `build.mjs` schedules the
pool into daily courses under the weekly rhythm and injects the result:

```bash
node build.mjs
```

`build.mjs` validates before writing and refuses to ship a broken set — it checks that each
chain's initials spell its seed, that every word starts with the right letter, that the
`links` text matches the words, and that no seed is reused. When scheduling it enforces that
no link repeats within a day and none returns inside `COOLDOWN_DAYS`. Days that can't meet
their weekday quota of long chains are flagged with `!` in the build output rather than
passed off as complete.
The puzzle data is base64'd into the page so a casual view-source doesn't spoil answers.
That's obfuscation, not security.

## Finding new chains

Authoring these by hand is hard: each word has to link backwards *and* forwards *and* start
with a letter fixed by the seed. `tools/chain-finder.mjs` searches the phrase graph in
`tools/pairs.txt` (2,856 pairs) for every valid chain whose initials spell a seed from
`tools/seeds.txt` — a hand-checked allowlist of words people actually know, because the
system dictionary is a 1934 Webster's full of entries like HOWFF and SPOSH. It keeps the
best-scoring chain per seed, ranked by how familiar the links are.

```bash
node tools/chain-finder.mjs
```

Add pairs to `tools/pairs.txt` to widen the search. It only proposes candidates — the results
still need a human to throw out the ones nobody actually says.
