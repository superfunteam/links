-- Server-side errors, each with a short reference the player can read out or
-- paste. The backroom lists them, so a copied report can be matched to the
-- exact failure without asking anyone for logs.
create table error_log (
  ref     text        primary key,
  op      text        not null,
  message text        not null,
  at      timestamptz not null default now()
);
create index error_log_recent on error_log (at desc);
