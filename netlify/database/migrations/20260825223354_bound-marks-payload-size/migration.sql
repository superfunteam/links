-- The existing CHECK bounded only the OUTER array, so a single hole holding
-- 200k mark objects passed it and stored megabytes — and marks are read for
-- every club member, so one hostile row would bloat every friend's Club screen.
-- The app already clamps this; the database should not depend on that.
alter table rounds drop constraint if exists rounds_marks_check;

alter table rounds add constraint rounds_marks_check check (
  jsonb_typeof(marks) = 'array'
  and jsonb_array_length(marks) <= 12
  and length(marks::text) <= 4096
);

-- A round can't predate the game itself.
alter table rounds add constraint rounds_not_ancient check (play_date >= date '2026-08-01');
