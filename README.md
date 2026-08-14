# Links

Hit the links!

A word game. Each hole gives you a **seed word** — its letters are the first letters of a
chain, and every neighbouring pair forms a compound word or common phrase. The first word
is free; you fill in the rest.

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

## Running it

It's one self-contained `index.html` with no build step and no dependencies — open it, or
serve the folder:

```bash
python3 -m http.server 4321
```

Deployed on Netlify by publishing the repo root.

## Editing puzzles

`puzzles.json` is the source of truth. After editing it, re-inject it into the page:

```bash
node build.mjs
```

`build.mjs` validates before writing and refuses to ship a broken set — it checks that each
chain's initials spell its seed, that every word starts with the right letter, that the
`links` text matches the words, and that no seed or link is reused anywhere in the set.
The puzzle data is base64'd into the page so a casual view-source doesn't spoil answers.
That's obfuscation, not security.

## Finding new chains

Authoring these by hand is hard: each word has to link backwards *and* forwards *and* start
with a letter fixed by the seed. `tools/chain-finder.mjs` searches a curated graph of
compound phrases for every valid chain whose initials spell a real dictionary word.

```bash
node tools/chain-finder.mjs
```

Add pairs to its `PAIRS` list to widen the search. It only proposes candidates — the results
still need a human to throw out the ones nobody actually says.
