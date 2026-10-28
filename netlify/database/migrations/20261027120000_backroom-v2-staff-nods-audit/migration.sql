-- Backroom v2: named staff accounts instead of one shared key, sessions, an
-- audit trail of every change, per-hole newsroom "nods", and org settings.
-- Additive only: nothing existing is dropped except two CHECK constraints that
-- are immediately re-added wider.

create table staff (
  id          bigserial   primary key,
  email       text        not null unique,             -- stored lowercased
  name        text        not null,
  role        text        not null check (role in ('owner','editor','viewer')),
  pw_hash     text        not null,                    -- scrypt$N$r$p$salt$hash
  created_at  timestamptz not null default now(),
  last_seen   timestamptz,
  disabled    boolean     not null default false
);

-- Only the SHA-256 of a session token is stored.
create table staff_sessions (
  token_hash  text        primary key,
  staff_id    bigint      not null references staff (id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null,
  last_seen   timestamptz
);
create index staff_sessions_staff on staff_sessions (staff_id);

create table staff_login_attempts (
  email       text        not null,
  ok          boolean     not null,
  at          timestamptz not null default now()
);
create index staff_login_attempts_recent on staff_login_attempts (email, at);

create table audit_log (
  id          bigserial   primary key,
  at          timestamptz not null default now(),
  staff_id    bigint      references staff (id) on delete set null,
  actor       text,                                   -- name at the time, survives removal
  action      text        not null,
  target      text,
  detail      jsonb
);
create index audit_log_at on audit_log (at desc);

-- A quiet pointer to newsroom content beside a hole's result. Nods never
-- change a day's courseKey, so they may be edited on any date.
create table hole_nods (
  day         date        not null,
  hole_idx    smallint    not null check (hole_idx between 0 and 11),
  icon        text        not null check (icon in ('listen','read','watch')),
  text        text        not null check (length(text) between 1 and 140),
  label       text        not null check (length(label) between 1 and 140),
  url         text        not null check (url ~ '^https://' and length(url) <= 600),
  updated_by  bigint      references staff (id) on delete set null,
  updated_at  timestamptz not null default now(),
  primary key (day, hole_idx)
);

create table org_settings (
  key         text        primary key,
  value       jsonb       not null,
  updated_at  timestamptz not null default now()
);

alter table schedule_days add column if not exists updated_at timestamptz default now();
alter table schedule_days add column if not exists updated_by bigint references staff (id) on delete set null;

alter table drafts add column if not exists created_by bigint references staff (id) on delete set null;
alter table drafts add column if not exists updated_at timestamptz default now();
-- the original inline check was auto-named drafts_status_check
alter table drafts drop constraint if exists drafts_status_check;
alter table drafts add constraint drafts_status_check check (status in ('draft','approved','archived'));

-- the original inline check was auto-named events_kind_check; round_resume was
-- already sent by the game (startCourse) but never allowed, so it is added here too
alter table events drop constraint if exists events_kind_check;
alter table events add constraint events_kind_check check (kind in
  ('open','round_start','round_resume','practice_start','share_card','share_code','nudge','drill_down','nod_click'));
