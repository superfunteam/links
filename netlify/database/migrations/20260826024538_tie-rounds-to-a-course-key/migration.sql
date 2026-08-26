-- A round belongs to a puzzle, not just a date. The key is a fingerprint of
-- the day's chains, computed identically by client and server, so if a date's
-- puzzle ever changes edition, old scores can't silently attach to the new one.
alter table rounds add column course_key text
  check (course_key is null or course_key ~ '^[a-z0-9]{4,12}$');
