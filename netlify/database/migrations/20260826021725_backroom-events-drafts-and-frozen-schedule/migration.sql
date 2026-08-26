-- The backroom: lightweight analytics events, a drafts table for the puzzle
-- editor, and a frozen record of which puzzles each day actually served.

-- One row per thing that happened. Deliberately tiny: a kind, an optional
-- player, an optional course date, a timestamp. Everything the backroom
-- charts is an aggregate over this.
create table events (
  id          bigserial   primary key,
  kind        text        not null check (kind in
                ('open','round_start','practice_start','share_card','share_code','nudge','drill_down')),
  player_id   bigint      references players (id) on delete set null,
  day         date,
  created_at  timestamptz not null default now()
);
create index events_kind_at on events (kind, created_at desc);
create index events_at on events (created_at desc);

-- Puzzles written in the editor. Approved drafts are merged into the pool at
-- build time; archived ones are kept for the record but never scheduled.
create table drafts (
  id          bigserial   primary key,
  seed        text        not null check (seed ~ '^[A-Z]{3,5}$'),
  words       jsonb       not null check (jsonb_typeof(words) = 'array'),
  links       jsonb       not null check (jsonb_typeof(links) = 'array'),
  status      text        not null default 'approved' check (status in ('approved','archived')),
  created_at  timestamptz not null default now()
);

-- Which holes each date actually served. The scheduler consults this before
-- assigning anything, so a day that has been published can never reshuffle —
-- without it, adding one draft to the pool would change history.
create table schedule_days (
  day         date        primary key,
  name        text        not null,
  holes       jsonb       not null check (jsonb_typeof(holes) = 'array'),
  created_at  timestamptz not null default now()
);
