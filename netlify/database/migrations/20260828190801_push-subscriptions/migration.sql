-- One row per device that asked for the daily reminder. The endpoint is the
-- identity; tz lets the hourly sender fire at each device's own 9am, and
-- last_sent stops a device hearing about the same day twice.
create table push_subs (
  endpoint   text        primary key,
  keys       jsonb       not null,
  tz         text        not null default 'America/New_York',
  player_id  bigint      references players (id) on delete cascade,
  last_sent  date,
  created_at timestamptz not null default now()
);
