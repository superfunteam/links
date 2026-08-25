-- Sign-in is email + friend code, and the friend code is public by design.
-- Throttling is what stops someone walking a known code into an account by
-- guessing the email, or vice versa.
create table signin_attempts (
  id          bigserial   primary key,
  -- what was tried, lowercased; never joined back to players
  email       text        not null,
  ok          boolean     not null,
  at          timestamptz not null default now()
);

create index signin_attempts_recent on signin_attempts (email, at desc);
