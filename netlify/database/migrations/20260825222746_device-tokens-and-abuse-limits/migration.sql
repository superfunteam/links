-- The 4-character code is PUBLIC — players read it aloud to friends. It can
-- therefore address a player but must never authenticate one. Writes are proved
-- by a 128-bit device token instead; only its hash is stored.
create table devices (
  token_hash  text        primary key,
  player_id   bigint      not null references players (id) on delete cascade,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);

create index devices_player on devices (player_id);

-- Coarse abuse budgets. Failures are what's counted: a real player looks up a
-- handful of codes in a lifetime, so this never touches honest use.
create table rate_limits (
  key           text        primary key,
  window_start  timestamptz not null default now(),
  count         integer     not null default 0
);

-- Who initiated a friendship, so "remove everyone I didn't add" stays possible.
alter table friendships add column initiated_by bigint references players (id) on delete set null;
