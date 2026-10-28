// Calendar: a month of courses. A 7-column grid (Mon–Sun) on md+, an agenda list on phones.
// Source of truth is the `calendar` op (schedule_days rows); dates without a row auto-fill on publish.
import { api } from '../api.mjs';
import { h, pageHeader, button, badge, iconEl, fmt } from '../ui.mjs';

const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const WEEKDAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
// Five-word holes each weekday should carry (Mon 1 … Sun 5).
const LONG_HOLES = [1, 2, 2, 3, 4, 5, 5];

const shiftMonth = (month, by) => {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};
const monthLabel = (month) => {
  const [y, m] = month.split('-').map(Number);
  return new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
};
// 0 = Monday … 6 = Sunday, for a YYYY-MM-DD date.
const weekdayIdx = (date) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
const dayNum = (date) => Number(date.slice(8, 10));

const STATUS = {
  live: { label: 'Live', tone: 'brand' },
  scheduled: { label: 'Scheduled', tone: 'blue' },
  past: { label: 'Past', tone: 'neutral' },
};

// Auto days get a dashed outline badge instead of a filled one.
const autoBadge = (label) => h('span', {
  class: 'inline-flex items-center rounded-md border border-dashed border-zinc-950/20 px-1.5 text-sm/5 font-medium whitespace-nowrap text-zinc-500 sm:text-xs/5 dark:border-white/20 dark:text-zinc-400',
  title: 'Auto-fills on publish',
}, label);

const statusBadge = (status, { long = false } = {}) => {
  if (status === 'auto') return autoBadge(long ? 'Auto-fills on publish' : 'Auto');
  const s = STATUS[status] || { label: status || 'Unknown', tone: 'neutral' };
  return badge({ label: s.label, tone: s.tone });
};

const editedDot = () => h('span', { class: 'inline-flex shrink-0 items-center', title: 'Edited since the last publish' },
  h('span', { class: 'size-1.5 rounded-full bg-amber-500 dark:bg-amber-400', 'aria-hidden': 'true' }),
  h('span', { class: 'sr-only' }, 'Edited since the last publish'));

const seedChips = (seeds = []) => seeds.length
  ? h('span', { class: 'flex min-w-0 flex-wrap gap-0.5' },
    seeds.map((s) => h('span', { class: 'rounded-sm bg-zinc-950/5 px-1 font-mono text-zinc-700 dark:bg-white/10 dark:text-zinc-300' }, String(s).toUpperCase())))
  : null;

// Small "icon + number" counters. Plays only mean something once a day has run.
const counters = (d) => {
  const items = [];
  if (d.status === 'past' || d.status === 'live') {
    items.push(h('span', { class: 'inline-flex items-center gap-x-1', title: `${fmt.num(d.plays)} plays` },
      iconEl('play', 'size-4 h-lh shrink-0 fill-zinc-400 dark:fill-zinc-500'),
      h('span', { class: 'tabular-nums' }, fmt.num(d.plays)),
      h('span', { class: 'sr-only' }, d.plays === 1 ? 'play' : 'plays')));
  }
  if (d.nods > 0) {
    items.push(h('span', { class: 'inline-flex items-center gap-x-1', title: `${fmt.num(d.nods)} nods` },
      iconEl('link', 'size-4 h-lh shrink-0 fill-zinc-400 dark:fill-zinc-500'),
      h('span', { class: 'tabular-nums' }, fmt.num(d.nods)),
      h('span', { class: 'sr-only' }, d.nods === 1 ? 'nod' : 'nods')));
  }
  return items.length ? items : null;
};

const courseName = (d) => d.name
  ? h('span', { class: 'truncate font-medium text-zinc-950 dark:text-white' }, d.name)
  : h('span', { class: 'truncate text-zinc-500 dark:text-zinc-400' }, d.status === 'auto' ? 'Not planned' : 'No course');

const dayLabel = (d, today) => [
  fmt.date(d.date),
  d.date === today ? 'today' : null,
  d.name || null,
  d.status === 'auto' ? 'auto-fills on publish' : (STATUS[d.status]?.label || null),
  d.unpublished ? 'edited since the last publish' : null,
].filter(Boolean).join(', ');

// ── md+: month grid ──────────────────────────────────────────────────────────
const gridCell = (d, today) => {
  const isToday = d.date === today;
  const isPast = d.status === 'past';
  return h('a', {
    href: `#/day/${d.date}`,
    'aria-label': dayLabel(d, today),
    'aria-current': isToday ? 'date' : null,
    class: [
      'flex min-h-32 min-w-0 flex-col justify-between gap-y-1.5 rounded-lg p-2 text-sm/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600',
      d.status === 'auto'
        ? 'border border-dashed border-zinc-950/15 hover:bg-zinc-950/2.5 dark:border-white/15 dark:hover:bg-white/2.5'
        : 'bg-white hover:bg-zinc-50 dark:bg-white/2.5 dark:hover:bg-white/5',
      isToday ? 'ring-2 ring-brand-500' : d.status === 'auto' ? '' : 'ring-1 ring-zinc-950/10 dark:ring-white/10',
      isPast ? 'text-zinc-500 dark:text-zinc-400' : 'text-zinc-700 dark:text-zinc-300',
    ].join(' '),
  },
    h('span', { class: 'grid min-w-0 gap-y-1.5', 'aria-hidden': 'true' },
    h('span', { class: 'flex items-center justify-between gap-x-1.5' },
      h('span', { class: 'flex items-center gap-x-1.5' },
      h('span', { class: isToday ? 'font-semibold text-brand-700 tabular-nums dark:text-brand-300' : isPast ? 'tabular-nums' : 'font-medium text-zinc-950 tabular-nums dark:text-white' }, dayNum(d.date)),
      d.unpublished ? editedDot() : null),
      h('span', { class: 'min-w-0' }, statusBadge(d.status))),
    h('span', { class: 'flex min-w-0' }, courseName(d)),
    h('span', { class: 'block text-sm/5' }, seedChips(d.seeds))),
    h('span', { class: 'flex flex-wrap items-center gap-x-2.5 text-zinc-500 dark:text-zinc-400', 'aria-hidden': 'true' }, counters(d)));
};

const monthGrid = (days, today) => {
  const lead = days.length ? weekdayIdx(days[0].date) : 0;
  const trail = (7 - ((lead + days.length) % 7)) % 7;
  const blank = () => h('div', { class: 'min-h-32 rounded-lg bg-zinc-950/2.5 dark:bg-white/2.5', 'aria-hidden': 'true' });
  return h('div', { class: 'grid gap-y-2 max-md:hidden' },
    h('div', { class: 'grid grid-cols-7 gap-x-2', 'aria-hidden': 'true' },
      WEEKDAYS.map((w, i) => h('div', { class: 'flex items-baseline justify-between gap-x-1 px-2 text-sm/6 font-medium text-zinc-500 dark:text-zinc-400', title: `${WEEKDAYS_LONG[i]}: ${LONG_HOLES[i]} five-word ${LONG_HOLES[i] === 1 ? 'hole' : 'holes'}` },
        h('span', {}, w),
        h('span', { class: 'font-normal text-zinc-400 tabular-nums dark:text-zinc-500' }, `${LONG_HOLES[i]}×5`)))),
    h('ol', { role: 'list', class: 'grid grid-cols-7 gap-2' },
      Array.from({ length: lead }, () => h('li', { 'aria-hidden': 'true', class: 'grid' }, blank())),
      days.map((d) => h('li', { class: 'grid min-w-0' }, gridCell(d, today))),
      Array.from({ length: trail }, () => h('li', { 'aria-hidden': 'true', class: 'grid' }, blank()))));
};

// ── phones: agenda list ──────────────────────────────────────────────────────
const agendaRow = (d, today) => {
  const isToday = d.date === today;
  const isPast = d.status === 'past';
  const wd = weekdayIdx(d.date);
  return h('li', {},
    h('a', {
      href: `#/day/${d.date}`,
      'aria-label': dayLabel(d, today),
      'aria-current': isToday ? 'date' : null,
      class: [
        'flex items-start gap-x-4 rounded-lg px-3 py-3 hover:bg-zinc-950/2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 dark:hover:bg-white/2.5',
        isToday ? 'ring-2 ring-brand-500' : '',
      ].join(' '),
    },
      h('div', { class: 'grid w-10 shrink-0 text-center', 'aria-hidden': 'true' },
        h('p', { class: 'text-base/6 text-zinc-500 sm:text-sm/5 dark:text-zinc-400' }, WEEKDAYS[wd]),
        h('p', { class: isToday ? 'text-xl/7 font-semibold text-brand-700 tabular-nums dark:text-brand-300' : isPast ? 'text-xl/7 text-zinc-500 tabular-nums dark:text-zinc-400' : 'text-xl/7 font-medium text-zinc-950 tabular-nums dark:text-white' }, dayNum(d.date))),
      h('div', { class: 'grid min-w-0 flex-1 gap-y-1.5', 'aria-hidden': 'true' },
        h('div', { class: 'flex min-w-0 items-center gap-x-2 text-base/6' }, courseName(d), d.unpublished ? editedDot() : null),
        h('div', { class: 'text-base/6 sm:text-sm/5' }, seedChips(d.seeds)),
        h('div', { class: 'flex flex-wrap items-center gap-x-3 text-base/6 text-zinc-500 dark:text-zinc-400' }, counters(d))),
      h('div', { class: 'shrink-0', 'aria-hidden': 'true' }, statusBadge(d.status, { long: d.status === 'auto' }))));
};

const agendaList = (days, today) =>
  h('ol', { role: 'list', class: 'grid gap-y-1 md:hidden' }, days.map((d) => agendaRow(d, today)));

// ── Legend + weekly rhythm ───────────────────────────────────────────────────
const legend = () => {
  const item = (node, text) => h('li', { class: 'flex items-center gap-x-2' }, node, h('span', {}, text));
  return h('div', { class: 'grid gap-y-3 border-t border-zinc-950/5 pt-6 text-base/6 text-zinc-500 sm:text-sm/6 dark:border-white/10 dark:text-zinc-400' },
    h('ul', { role: 'list', class: 'flex flex-wrap gap-x-6 gap-y-2' },
      item(statusBadge('live'), 'Today’s course.'),
      item(statusBadge('scheduled'), 'Planned and saved.'),
      item(statusBadge('past'), 'Already played.'),
      item(autoBadge('Auto'), 'Auto-fills on publish.'),
      item(editedDot(), 'Edited since the last publish.')),
    h('p', { class: 'text-pretty' },
      'Weekly rhythm of five-word holes: ',
      h('span', { class: 'tabular-nums' }, WEEKDAYS.map((w, i) => `${w} ${LONG_HOLES[i]}`).join(', ')),
      '. Longer chains build toward the weekend.'));
};

export default async function view({ params, navigate }) {
  const want = MONTH_RE.test(params.month || '') ? params.month : undefined;
  const data = await api('calendar', want ? { month: want } : {});
  const month = data.month;
  const today = data.today;
  const days = data.days || [];
  const isThisMonth = today && today.slice(0, 7) === month;

  const planned = days.filter((d) => d.status === 'scheduled').length;
  const auto = days.filter((d) => d.status === 'auto').length;
  const edited = days.filter((d) => d.unpublished).length;
  const summary = [
    `${fmt.num(planned)} scheduled`,
    auto ? `${fmt.num(auto)} auto-fill` : null,
    edited ? `${fmt.num(edited)} edited since the last publish` : null,
  ].filter(Boolean).join(' · ');

  const toolbar = h('div', { class: 'flex flex-wrap items-center justify-between gap-3' },
    h('div', { class: 'min-w-0' },
      h('h2', { class: 'text-lg font-semibold text-balance text-zinc-950 sm:text-base dark:text-white', 'aria-live': 'polite' }, monthLabel(month)),
      h('p', { class: 'text-base/6 text-zinc-500 tabular-nums sm:text-sm/6 dark:text-zinc-400' }, summary)),
    h('div', { class: 'flex shrink-0 items-center gap-2' },
      button({ label: 'Today', disabled: isThisMonth, onClick: () => navigate('/calendar') }),
      h('div', { class: 'flex items-center gap-1' },
        button({ icon: 'chevron-left', 'aria-label': 'Previous month', title: 'Previous month', onClick: () => navigate(`/calendar/${shiftMonth(month, -1)}`) }),
        button({ icon: 'chevron-right', 'aria-label': 'Next month', title: 'Next month', onClick: () => navigate(`/calendar/${shiftMonth(month, 1)}`) }))));

  return h('div', { class: 'grid gap-y-8' },
    pageHeader({ title: 'Calendar', description: 'Plan which course runs on each day. Select a day to see or edit it.' }),
    h('div', { class: 'grid gap-y-6' },
      toolbar,
      monthGrid(days, today),
      agendaList(days, today),
      legend()));
}
