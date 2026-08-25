-- ============================================================================
--  LINKS — database schema v1
--  Postgres. Runs top-to-bottom on an empty database. No extensions required.
-- ============================================================================

-- ─────────────────────────────────────────────────────────────────────────────
--  players — one row per person. The 4-character code IS the identity.
--
--  The code is public (players read it aloud to friends), permanent, and the
--  primary key, so every other table refers to a person the same way the UI
--  does. It is stored as text, not char(4): bpchar silently strips trailing
--  spaces in some comparisons and casts, which is a bad trait for a key.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE players (
  code          text        PRIMARY KEY
                            -- The reduced alphabet: no I, O, 0 or 1.
                            CHECK (code ~ '^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$'),

  name          text        CHECK (name IS NULL OR length(btrim(name)) BETWEEN 1 AND 24),

  -- Optional. Stored already trimmed and lowercased so a plain UNIQUE index
  -- is enough for case-insensitive sign-in; the CHECK makes an un-normalised
  -- write fail loudly instead of creating a second account for the same
  -- person with a capital letter in it.
  email         text        UNIQUE
                            CHECK (email IS NULL OR (
                              email = btrim(lower(email))
                              AND email LIKE '%_@_%.__%'
                              AND length(email) <= 254
                            )),

  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
--  rounds — one completed round per player per day. Immutable once written.
--
--  par is stored on the row rather than looked up, because the puzzle set
--  lives in the page, not the database; a round row explains itself with no
--  reference to the day's course.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE rounds (
  player_code  text        NOT NULL REFERENCES players(code) ON DELETE CASCADE,

  -- The US-Eastern course date, computed by the client and sent as YYYY-MM-DD.
  -- Never derive this server-side from now(): a function running in UTC would
  -- file an 8pm-Eastern round under tomorrow's course.
  played_on    date        NOT NULL,

  strokes      smallint    NOT NULL CHECK (strokes BETWEEN 1 AND 999),
  par          smallint    NOT NULL CHECK (par BETWEEN 1 AND 999),

  -- [[{"g":1,"b":0}, ...], ...] — one inner array per hole, one object per
  -- word, exactly as the share card renders it.
  marks        jsonb       NOT NULL CHECK (
                             jsonb_typeof(marks) = 'array'
                             AND jsonb_array_length(marks) BETWEEN 1 AND 24
                           ),

  -- Optional: strokes per hole, for the scorecard. Nullable so the submit
  -- payload can stay {player, date, strokes, par, marks} if you prefer.
  hole_scores  smallint[]  CHECK (hole_scores IS NULL OR
                                  array_length(hole_scores, 1) BETWEEN 1 AND 24),

  created_at   timestamptz NOT NULL DEFAULT now(),

  -- First-write-wins and idempotent retry both come from this one constraint,
  -- via INSERT ... ON CONFLICT DO NOTHING. Never ON CONFLICT DO UPDATE here.
  PRIMARY KEY (player_code, played_on)
);

-- ─────────────────────────────────────────────────────────────────────────────
--  friendships — one row per PAIR, not per direction.
--
--  The pair is stored in sorted order, so "A adds B" and "B adds A" compute
--  the same row and the second one is a no-op. Mutuality isn't a rule the
--  application has to remember; there is no shape the table can take in which
--  a friendship exists for one person and not the other. The CHECK also rules
--  out befriending yourself, since that would need low = high.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE friendships (
  low_code   text        NOT NULL REFERENCES players(code) ON DELETE CASCADE,
  high_code  text        NOT NULL REFERENCES players(code) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (low_code, high_code),
  CHECK (low_code < high_code)
);

-- The PK indexes the low side; friendships where you are the high side need
-- their own index, or half your club is a sequential scan.
CREATE INDEX friendships_high_idx ON friendships (high_code, low_code);

-- Expands each stored pair back into two directed edges, so club queries can
-- just say "WHERE player_code = $1" and forget the ordering trick exists.
CREATE VIEW friend_edges AS
  SELECT low_code  AS player_code, high_code AS friend_code FROM friendships
  UNION ALL
  SELECT high_code AS player_code, low_code  AS friend_code FROM friendships;

-- ─────────────────────────────────────────────────────────────────────────────
--  sign_in_attempts — a failure counter, so email+code can't be brute-forced.
--
--  There are only 1,048,576 possible codes. Someone who knows a player's email
--  could walk the whole space in an afternoon; a serverless function has
--  nowhere to count attempts except the database. Costs the honest player
--  nothing: they type their email and code once and are never counted.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE sign_in_attempts (
  email        text NOT NULL,
  attempted_on date NOT NULL,
  failures     int  NOT NULL DEFAULT 0,

  PRIMARY KEY (email, attempted_on)
);

-- ============================================================================
--  The six access patterns, as the statements that serve them.
--  (Reference only — these are queries, not schema.)
-- ============================================================================
--
--  1. First contact from a device
--     INSERT INTO players (code) VALUES ($1)
--       ON CONFLICT (code) DO NOTHING
--       RETURNING code;
--     Zero rows means the code belongs to someone else: generate a new one and
--     try again. Never adopt the existing row — that is the merge this schema
--     exists to prevent. Only call this when the device has no stored code.
--
--  2. Submit a finished round — first-write-wins, idempotent, one round trip
--     WITH ins AS (
--       INSERT INTO rounds (player_code, played_on, strokes, par, marks, hole_scores)
--       VALUES ($1,$2,$3,$4,$5,$6)
--       ON CONFLICT (player_code, played_on) DO NOTHING
--       RETURNING strokes, par, marks, true AS counted
--     )
--     SELECT * FROM ins
--     UNION ALL
--     SELECT strokes, par, marks, false AS counted FROM rounds
--     WHERE player_code = $1 AND played_on = $2 AND NOT EXISTS (SELECT 1 FROM ins);
--     Always returns exactly one row: the round that counts, plus whether this
--     call is the one that set it. A retry after a dropped response returns the
--     same round with counted = false, which is also what a replay returns —
--     the client already draws that case ("not counting").
--
--  3. The Club screen — player, friends, today's round, last 7 days
--     WITH club AS (
--       SELECT $1::text AS code
--       UNION
--       SELECT friend_code FROM friend_edges WHERE player_code = $1
--     )
--     SELECT p.code, p.name,
--            r.strokes AS today_strokes, r.par AS today_par, r.marks AS today_marks,
--            f.form
--     FROM club c
--     JOIN players p ON p.code = c.code
--     LEFT JOIN rounds r ON r.player_code = p.code AND r.played_on = $2::date
--     LEFT JOIN LATERAL (
--       SELECT json_agg(json_build_object('d', d.played_on, 's', d.strokes, 'p', d.par)
--                       ORDER BY d.played_on) AS form
--       FROM rounds d
--       WHERE d.player_code = p.code AND d.played_on > $2::date - 7
--                                    AND d.played_on <= $2::date
--     ) f ON TRUE;
--     A NULL today_strokes is "hasn't played yet" — distinct from a bad round,
--     which has a number.
--
--  4. Add a friend by code
--     INSERT INTO friendships (low_code, high_code)
--     VALUES (LEAST($1,$2), GREATEST($1,$2))
--       ON CONFLICT DO NOTHING;
--     A bad code raises foreign_key_violation (23503) → "no player with that
--     code". Self-add raises check_violation (23514). Unfriending is
--     DELETE ... WHERE low_code = LEAST($1,$2) AND high_code = GREATEST($1,$2).
--
--  5. Claim — attach an email
--     UPDATE players SET email = btrim(lower($2)) WHERE code = $1;
--     unique_violation (23505) → that email already belongs to another player.
--
--  6. Sign in on a new device
--     SELECT code, name FROM players
--     WHERE email = btrim(lower($1)) AND code = $2;
--     On a miss, count it:
--     INSERT INTO sign_in_attempts (email, attempted_on, failures)
--     VALUES (btrim(lower($1)), $3::date, 1)
--       ON CONFLICT (email, attempted_on)
--       DO UPDATE SET failures = sign_in_attempts.failures + 1
--       RETURNING failures;
--     Refuse above ~10 for the rest of the day. Sweep old rows whenever:
--     DELETE FROM sign_in_attempts WHERE attempted_on < $3::date - 7;
-- ============================================================================
