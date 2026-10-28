// Dashboard: KPIs, 14-day plays, puzzle runway, the week ahead, recent activity, build status.
import { api } from '../api.mjs';
import { h, pageHeader, section, statGrid, table, badge, button, descriptionList, emptyState, fmt } from '../ui.mjs';
import { activityColumns } from './activity.mjs';

const STATUS = {
  live: ['Live', 'brand'],
  scheduled: ['Scheduled', 'blue'],
  auto: ['Auto', 'neutral'],
  past: ['Played', 'neutral'],
  draft: ['Draft', 'amber'],
};
// build.mjs only ever sets these three values.
const DB_STATUS = { direct: ['Connected', 'brand'], 'via-site-api': ['Connected via site', 'brand'], 'repo-only': ['Repo only', 'amber'] };
export const statusBadge = (s) => { const [l, t] = STATUS[s] || [s || 'Unknown', 'neutral']; return badge({ label: l, tone: t }); };

const seedChips = (seeds = []) => h('span', { class: 'inline-flex flex-wrap gap-1' },
  seeds.map((s) => h('span', { class: 'rounded-sm bg-zinc-950/5 px-1 font-mono text-zinc-700 dark:bg-white/10 dark:text-zinc-300' }, String(s).toUpperCase())));

// Single-series bar chart: rounds per day. Bars are brand-500 with a 2px gap and a
// per-bar hover tooltip; an sr-only table carries the same data.
const playsChart = (plays = []) => {
  if (!plays.length) return emptyState({ title: 'No rounds yet', body: 'Rounds played show up here once players start.' });
  const max = Math.max(1, ...plays.map((d) => d.rounds | 0));
  const tip = h('div', { class: 'pointer-events-none absolute bottom-(--tip-y) left-(--tip-x) z-10 -translate-x-1/2 rounded-md bg-zinc-950 px-2 py-1 text-sm/5 whitespace-nowrap text-white tabular-nums dark:bg-white dark:text-zinc-950', hidden: true });
  const bars = plays.map((d, i) => {
    const pct = Math.round(((d.rounds | 0) / max) * 100);
    const col = h('div', {
      class: 'group relative flex h-full min-w-0 flex-1 cursor-default items-end',
      tabindex: '0',
      'aria-label': `${fmt.date(d.date)}: ${fmt.num(d.rounds)} rounds`,
    },
      h('div', { class: 'h-(--bar) min-h-px w-full rounded-t-sm bg-brand-500 group-hover:bg-brand-600 group-focus-visible:bg-brand-600 dark:bg-brand-500 dark:group-hover:bg-brand-300', style: { '--bar': `${pct}%` } }));
    const show = () => {
      tip.textContent = `${fmt.dateShort(d.date)} · ${fmt.num(d.rounds)} rounds`;
      tip.hidden = false;
      tip.style.setProperty('--tip-x', `${((i + 0.5) / plays.length) * 100}%`);
      tip.style.setProperty('--tip-y', `calc(${pct}% + 0.5rem)`);
    };
    col.addEventListener('mouseenter', show); col.addEventListener('focus', show);
    col.addEventListener('mouseleave', () => { tip.hidden = true; }); col.addEventListener('blur', () => { tip.hidden = true; });
    return col;
  });
  const first = plays[0], last = plays[plays.length - 1];
  return h('figure', { class: 'grid gap-y-2' },
    h('div', { class: 'relative h-40 border-b border-zinc-950/10 dark:border-white/10', 'aria-hidden': 'false' },
      h('div', { class: 'absolute inset-x-0 top-0 flex items-center justify-between text-sm/5 text-zinc-500 tabular-nums dark:text-zinc-400', 'aria-hidden': 'true' },
        h('span', {}, ''), h('span', {}, `Peak ${fmt.num(max)}`)),
      h('div', { class: 'absolute inset-x-0 top-6 bottom-0 flex items-end gap-0.5' }, bars),
      tip),
    h('div', { class: 'flex justify-between text-sm/5 text-zinc-500 tabular-nums dark:text-zinc-400', 'aria-hidden': 'true' },
      h('span', {}, fmt.dateShort(first.date)), h('span', {}, fmt.dateShort(last.date))),
    h('table', { class: 'sr-only' },
      h('caption', {}, 'Rounds played per day'),
      h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Date'), h('th', { scope: 'col' }, 'Rounds'))),
      h('tbody', {}, plays.map((d) => h('tr', {}, h('td', {}, fmt.date(d.date)), h('td', {}, fmt.num(d.rounds)))))));
};

const runwayTone = (weeks) => (weeks == null ? 'neutral' : weeks < 2 ? 'red' : weeks < 4 ? 'amber' : 'brand');

const runwayBlock = (runway = {}) => {
  const by = runway.byLength || {};
  const weeks = runway.fiveWordWeeks;
  return h('div', { class: 'grid gap-y-4' },
    h('div', { class: 'flex flex-wrap items-center gap-2 text-base/6 sm:text-sm/6' },
      badge({ label: weeks == null ? 'No estimate' : `${fmt.num(Math.floor(weeks))} weeks of 5-word chains`, tone: runwayTone(weeks) }),
      runway.fiveWordDays != null ? h('span', { class: 'text-zinc-500 tabular-nums dark:text-zinc-400' }, `about ${fmt.num(runway.fiveWordDays)} days`) : null),
    descriptionList([
      ['3-word chains', h('span', { class: 'tabular-nums' }, fmt.num(by[3] ?? by['3'] ?? 0))],
      ['4-word chains', h('span', { class: 'tabular-nums' }, fmt.num(by[4] ?? by['4'] ?? 0))],
      ['5-word chains', h('span', { class: 'tabular-nums' }, fmt.num(by[5] ?? by['5'] ?? 0))],
    ]),
    h('p', { class: 'text-base/6 text-pretty text-zinc-500 sm:text-sm/6 dark:text-zinc-400' },
      'A week uses 21 five-word chains. Approved drafts and the reserve both count.'));
};

export default async function view({ navigate, me }) {
  const d = await api('dashboard');
  const k = d.kpis || {};
  const b = d.build || {};
  const canEdit = me?.role === 'owner' || me?.role === 'editor';

  const upcomingCols = [
    { key: 'date', label: 'Date', render: (r) => h('span', { class: 'font-medium text-zinc-950 dark:text-white' }, fmt.date(r.date)) },
    { key: 'name', label: 'Course', render: (r) => r.name || h('span', { class: 'text-zinc-500 dark:text-zinc-400' }, 'Untitled') },
    { key: 'seeds', label: 'Seeds', render: (r) => seedChips(r.seeds) },
    { key: 'nods', label: 'Nods', align: 'right', render: (r) => h('span', { class: 'tabular-nums' }, fmt.num(r.nods ?? 0)) },
    { key: 'status', label: 'Status', align: 'right', render: (r) => statusBadge(r.status) },
  ];

  return h('div', { class: 'grid gap-y-10' },
    pageHeader({
      title: 'Dashboard',
      description: 'How the game is doing this week, and what players get next.',
      actions: [
        button({ label: 'Open the game', icon: 'arrow-top-right-on-square', href: '/', target: '_blank' }),
        canEdit ? button({ label: 'Plan the calendar', variant: 'primary', icon: 'calendar-days', href: '#/calendar' }) : null,
      ],
    }),

    statGrid([
      { label: 'Players', value: fmt.num(k.players), sub: 'All time' },
      { label: 'Active players', value: fmt.num(k.active7), sub: 'Last 7 days' },
      { label: 'Rounds today', value: fmt.num(k.roundsToday), sub: 'Since midnight ET' },
      { label: 'Rounds', value: fmt.num(k.rounds7), sub: 'Last 7 days' },
      { label: 'Completion', value: fmt.pct(k.completion7), sub: 'Last 7 days' },
      { label: 'Nod clicks', value: fmt.num(k.nodClicks7), sub: 'Last 7 days' },
    ]),

    h('div', { class: '@container' },
      h('div', { class: 'grid gap-x-12 gap-y-10 @3xl:grid-cols-[3fr_2fr]' },
        section({ title: 'Rounds played', description: 'Last 14 days.' }, playsChart(d.plays14 || [])),
        section({ title: 'Puzzle runway', description: 'How long the puzzle supply lasts.', actions: button({ label: 'Puzzles', size: 'sm', variant: 'ghost', icon: 'puzzle-piece', href: '#/puzzles' }) },
          runwayBlock(d.runway)))),

    section({ title: 'Coming up', description: 'The next scheduled days. Select a day to edit it.', actions: button({ label: 'Calendar', size: 'sm', variant: 'ghost', icon: 'calendar-days', href: '#/calendar' }) },
      (d.upcoming || []).length
        ? table({ columns: upcomingCols, rows: d.upcoming, onRow: (r) => navigate(`/day/${r.date}`) })
        : emptyState({ title: 'Nothing scheduled', body: 'Days without a course are filled automatically on the next publish.' })),

    h('div', { class: '@container' },
      h('div', { class: 'grid gap-x-12 gap-y-10 @3xl:grid-cols-[3fr_2fr]' },
        section({ title: 'Recent activity', actions: button({ label: 'View all', size: 'sm', variant: 'ghost', icon: 'clock', href: '#/activity' }) },
          (d.recent || []).length
            ? table({ columns: activityColumns.filter((c) => c.key !== 'detail'), rows: d.recent.slice(0, 8), dense: true })
            : emptyState({ title: 'No activity yet', body: 'Edits and publishes show up here.' })),
        section({ title: 'Build' },
          descriptionList([
            ['Last publish', b.lastPublishAt ? h('time', { datetime: b.lastPublishAt, title: fmt.dateTime(b.lastPublishAt) }, fmt.rel(b.lastPublishAt)) : 'Never'],
            ['Site built', b.builtAt ? h('time', { datetime: b.builtAt, title: fmt.dateTime(b.builtAt) }, fmt.rel(b.builtAt)) : '—'],
            ['Unpublished changes', h('span', { class: 'tabular-nums' }, fmt.num(b.unpublished ?? 0))],
            ['Database', b.dbStatus ? (() => { const [l, t] = DB_STATUS[b.dbStatus] || [String(b.dbStatus), 'neutral']; return badge({ label: l, tone: t }); })() : '—'],
          ])))));
}
