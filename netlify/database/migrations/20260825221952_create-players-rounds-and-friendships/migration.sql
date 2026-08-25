-- Links: friends play.
-- Three small tables. A player is a device that has generated a friend code;
-- an email may later be attached so a second device can adopt the account.

create table players (
  id          bigserial primary key,
  -- the public 4-character friend code, from ABCDEFGHJKLMNPQRSTUVWXYZ23456789
  code        text        not null,
  name        text,
  email       text,
  created_at  timestamptz not null default now(),
  seen_at     timestamptz not null default now(),
  constraint players_code_shape check (code ~ '^[A-HJ-NP-Z2-9]{4}$')
);

-- Codes must be globally unique: a collision has to fail loudly at insert time
-- rather than quietly merging two people's accounts.
create unique index players_code_key on players (code);

-- Emails are matched case-insensitively, and only when one is set.
create unique index players_email_key on players (lower(email)) where email is not null;

create table rounds (
  player_id   bigint      not null references players (id) on delete cascade,
  -- the course date in US Eastern, which is how the game defines a day
  play_date   date        not null,
  strokes     integer     not null check (strokes >= 0 and strokes <= 999),
  par         integer     not null check (par > 0 and par <= 999),
  -- per-hole {g,b} counts behind the share card's emoji; bounded so a bad
  -- client can't push unbounded data into the row
  marks       jsonb       not null default '[]'::jsonb
                          check (jsonb_typeof(marks) = 'array' and jsonb_array_length(marks) <= 12),
  created_at  timestamptz not null default now(),
  -- one round per player per day, which is what makes first-write-wins possible
  primary key (player_id, play_date)
);

-- Serves the Club screen: every friend's rounds since a cutoff date.
create index rounds_recent on rounds (play_date desc, player_id);

create table friendships (
  -- Membership is mutual, so a pair is stored once in a canonical order.
  -- The check plus the primary key make "A adds B" and "B adds A" the same row,
  -- which removes any chance of duplicate or one-sided club membership.
  low_id      bigint      not null references players (id) on delete cascade,
  high_id     bigint      not null references players (id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (low_id, high_id),
  constraint friendships_ordered check (low_id < high_id)
);

-- Finding a player's friends means matching either column.
create index friendships_high on friendships (high_id);
