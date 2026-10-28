// Analytics: how each day played over a 7/30/90-day window — totals, a plays-per-day
// bar chart (inline SVG, no chart library) and a per-day table with CSV export.
import { api } from '../api.mjs';
import { h, pageHeader, section, statGrid, table, button, emptyState, errorState, skeleton, toast, id, fmt } from '../ui.mjs';

const RANGES = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
];
const DEFAULT_RANGE = '30';

// Today in the game's timezone (America/New_York), as YYYY-MM-DD.
const todayET = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const addDays = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Strokes relative to par, golf style: "+1.25", "−0.40", "E".
const vsPar = (v) => {
  if (v == null || Number.isNaN(+v)) return '—';
  const n = +v;
  if (Math.abs(n) < 0.005) return 'E';
  return `${n > 0 ? '+' : '−'}${Math.abs(n).toFixed(2)}`;
};
const ctr = (clicks, plays) => (plays ? clicks / plays : null);

// ── Segmented control (native radios, arrow keys work) ───────────────────────
const segmented = ({ label, options, value, onChange }) => {
  const name = id('seg');
  return h('fieldset', { class: 'min-w-0' },
    h('legend', { class: 'sr-only' }, label),
    h('div', { class: 'inline-flex rounded-lg bg-zinc-950/5 p-0.5 dark:bg-white/5' },
      options.map((o) => h('label', {
        class: 'relative rounded-md px-3 py-1 text-base/6 font-medium text-zinc-600 select-none hover:text-zinc-950 has-checked:bg-white has-checked:text-zinc-950 has-checked:shadow-xs has-checked:ring-1 has-checked:ring-zinc-950/10 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-brand-600 sm:text-sm/6 dark:text-zinc-400 dark:hover:text-white dark:has-checked:bg-white/10 dark:has-checked:text-white dark:has-checked:shadow-none dark:has-checked:ring-white/10',
      },
        h('input', {
          type: 'radio', name, value: o.value, checked: o.value === value, 'aria-label': o.label,
          class: 'absolute inset-0 size-full cursor-pointer appearance-none rounded-md focus:outline-hidden',
          'on:change': (e) => { if (e.target.checked) onChange(o.value); },
        }),
        o.label))));
};

// ── Bar chart: plays per day ─────────────────────────────────────────────────
// Rects use percentage units so bars stay crisp at any width without a stretched viewBox.
const niceMax = (v) => {
  if (v <= 4) return 4;
  const mag = 10 ** Math.floor(Math.log10(v));
  const step = [1, 2, 2.5, 5, 10].find((s) => s * mag * 4 >= v) * mag;
  return step * 4;
};

const SVG = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, String(v));
  for (const k of kids.flat(Infinity)) if (k != null) el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  return el;
};

const playsChart = (days, from, to) => {
  const n = days.length;
  const total = days.reduce((a, d) => a + (d.plays || 0), 0);
  if (!n || !total) return emptyState({ title: 'No plays in this range', body: 'Rounds show up here once players finish a course.' });

  const peak = Math.max(...days.map((d) => d.plays || 0));
  const top = niceMax(peak);
  const ticks = [top, top / 2, 0];
  const titleId = id('chart-title');
  const descId = id('chart-desc');
  const slot = 100 / n;
  const gap = n > 60 ? 0.2 : 0.25; // fraction of a slot left empty between bars

  const tip = h('div', { class: 'pointer-events-none absolute bottom-(--tip-y) left-(--tip-x) z-10 -translate-x-1/2 rounded-md bg-zinc-950 px-2 py-1 text-sm/5 whitespace-nowrap text-white tabular-nums dark:bg-white dark:text-zinc-950', hidden: true });
  const bars = [];
  const hits = [];
  days.forEach((d, i) => {
    const pct = ((d.plays || 0) / top) * 100;
    const bar = s('rect', {
      x: `${(i + gap / 2) * slot}%`, width: `${slot * (1 - gap)}%`,
      y: `${100 - pct}%`, height: `${pct}%`, rx: 2,
      class: 'fill-brand-500 data-active:fill-brand-700 dark:fill-brand-500 dark:data-active:fill-brand-300',
    });
    bars.push(bar);
    const hit = s('rect', { x: `${i * slot}%`, width: `${slot}%`, y: '0', height: '100%', class: 'fill-transparent' });
    hit.addEventListener('mouseenter', () => {
      bar.setAttribute('data-active', '');
      tip.textContent = `${fmt.dateShort(d.date)} · ${fmt.num(d.plays)} ${d.plays === 1 ? 'play' : 'plays'}${d.name ? ` · ${d.name}` : ''}`;
      tip.style.setProperty('--tip-x', `${Math.min(92, Math.max(8, (i + 0.5) * slot))}%`);
      tip.style.setProperty('--tip-y', `calc(${pct}% + 0.5rem)`);
      tip.hidden = false;
    });
    hit.addEventListener('mouseleave', () => { bar.removeAttribute('data-active'); tip.hidden = true; });
    hits.push(hit);
  });

  // Bars are translated 2px down and clipped so only their top corners show rounded.
  const svg = s('svg', { class: 'absolute inset-0 size-full overflow-hidden', role: 'img', 'aria-labelledby': titleId, 'aria-describedby': descId },
    s('title', { id: titleId }, 'Plays per day'),
    s('desc', { id: descId }, `${fmt.num(total)} plays from ${fmt.date(from)} to ${fmt.date(to)}. Busiest day: ${fmt.num(peak)} plays. The table below lists every day.`),
    ticks.map((t) => s('line', { x1: '0', x2: '100%', y1: `${100 - (t / top) * 100}%`, y2: `${100 - (t / top) * 100}%`, class: t === 0 ? 'stroke-zinc-950/15 dark:stroke-white/15' : 'stroke-zinc-950/5 dark:stroke-white/10', 'stroke-width': 1, 'shape-rendering': 'crispEdges' })),
    s('g', { transform: 'translate(0 2)' }, bars),
    hits);

  const mid = days[Math.floor((n - 1) / 2)];
  return h('figure', { class: 'grid grid-cols-[auto_1fr] gap-x-3 gap-y-2' },
    h('div', { class: 'relative h-48 w-[4ch] text-right text-sm/5 text-zinc-500 tabular-nums dark:text-zinc-400', 'aria-hidden': 'true' },
      ticks.map((t) => h('span', { class: 'absolute right-0 -translate-y-1/2 top-(--tick)', style: { '--tick': `${100 - (t / top) * 100}%` } }, fmt.num(t)))),
    h('div', { class: 'relative h-48' }, svg, tip),
    h('div', { 'aria-hidden': 'true' }),
    h('div', { class: 'flex justify-between gap-x-4 text-sm/5 text-zinc-500 tabular-nums dark:text-zinc-400', 'aria-hidden': 'true' },
      h('span', {}, fmt.dateShort(days[0].date)),
      n > 2 ? h('span', { class: 'max-sm:hidden' }, fmt.dateShort(mid.date)) : null,
      h('span', {}, fmt.dateShort(days[n - 1].date))));
};

// ── CSV export ───────────────────────────────────────────────────────────────
const csvCell = (v) => {
  if (v == null) return '';
  const str = String(v);
  return /[",\n\r]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
};
const downloadCsv = (days, from, to) => {
  const header = ['date', 'course', 'plays', 'starts', 'completion', 'avg_vs_par', 'under_par', 'nod_clicks', 'nod_ctr'];
  const lines = [header.join(',')].concat(days.map((d) => [
    d.date, d.name ?? '', d.plays ?? 0, d.starts ?? 0, d.completion ?? '', d.avgVsPar ?? '',
    d.underPar ?? 0, d.nodClicks ?? 0, d.plays ? +(d.nodClicks / d.plays).toFixed(4) : '',
  ].map(csvCell).join(',')));
  const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: `links-analytics-${from}-to-${to}.csv`, class: 'sr-only' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('CSV downloaded.');
};

// ── Results for one range ────────────────────────────────────────────────────
const results = (data, navigate) => {
  const t = data.totals || {};
  const days = data.days || [];
  const from = data.from, to = data.to;
  const rows = days.slice().reverse(); // newest first

  const columns = [
    { key: 'date', label: 'Date', render: (r) => h('span', { class: 'font-medium text-zinc-950 tabular-nums dark:text-white' }, fmt.date(r.date)) },
    { key: 'name', label: 'Course', render: (r) => r.name ? h('span', { class: 'inline-block max-w-56 truncate align-bottom' }, r.name) : h('span', { class: 'text-zinc-500 dark:text-zinc-400' }, 'No course') },
    { key: 'plays', label: 'Plays', align: 'right', render: (r) => h('span', { class: 'tabular-nums' }, fmt.num(r.plays)) },
    { key: 'completion', label: 'Completion', align: 'right', render: (r) => h('span', { class: 'tabular-nums' }, fmt.pct(r.completion)) },
    { key: 'avgVsPar', label: 'Avg vs par', align: 'right', render: (r) => h('span', { class: 'tabular-nums' }, vsPar(r.avgVsPar)) },
    { key: 'underPar', label: 'Under par', align: 'right', render: (r) => h('span', { class: 'tabular-nums' }, fmt.num(r.underPar)) },
    { key: 'nodClicks', label: 'Nod clicks', align: 'right', render: (r) => h('span', { class: 'tabular-nums' }, fmt.num(r.nodClicks)) },
  ];

  const rangeText = `${fmt.dateShort(from)} – ${fmt.dateShort(to)}`;
  return h('div', { class: 'grid gap-y-10' },
    statGrid([
      { label: 'Plays', value: fmt.num(t.plays), sub: t.players != null ? `${fmt.num(t.players)} players` : rangeText },
      { label: 'Completion rate', value: fmt.pct(t.completion), sub: t.starts != null ? `${fmt.num(t.starts)} rounds started` : null },
      { label: 'Average vs par', value: vsPar(t.avgVsPar), sub: t.underPar != null ? `${fmt.num(t.underPar)} rounds under par` : null },
      { label: 'Nod clicks', value: fmt.num(t.nodClicks), sub: rangeText },
      { label: 'Nod click rate', value: fmt.pct(ctr(t.nodClicks, t.plays), 1), sub: 'Clicks per play' },
    ]),
    section({ title: 'Plays per day', description: `Finished rounds, ${rangeText}.` }, playsChart(days, from, to)),
    section({
      title: 'By day',
      description: 'Select a day to open its course.',
      actions: button({ label: 'Download CSV', size: 'sm', disabled: !days.length, onClick: () => downloadCsv(days, from, to) }),
    }, table({ columns, rows, onRow: (r) => navigate(`/day/${r.date}`), empty: 'No days in this range.' })));
};

export default async function view({ query, navigate }) {
  let range = RANGES.some((r) => r.value === query?.range) ? query.range : DEFAULT_RANGE;
  const fetchRange = (r) => {
    const to = todayET();
    return api('analytics', { from: addDays(to, -(Number(r) - 1)), to });
  };

  const body = h('div', { 'aria-live': 'polite', 'aria-busy': 'false' });
  let seq = 0;
  const load = async (r, { initial = false, data } = {}) => {
    const mine = ++seq;
    if (!data) {
      body.setAttribute('aria-busy', 'true');
      if (!initial) body.replaceChildren(skeleton(6));
      try { data = await fetchRange(r); }
      catch (err) {
        if (mine !== seq || err?.status === 401) return;
        if (initial) throw err;
        body.setAttribute('aria-busy', 'false');
        body.replaceChildren(errorState(err, () => load(r)));
        return;
      }
    }
    if (mine !== seq) return;
    body.setAttribute('aria-busy', 'false');
    body.replaceChildren(results(data, navigate));
  };

  // First load throws to the router so its standard error state shows.
  const first = await fetchRange(range);
  await load(range, { initial: true, data: first });

  const onRange = (r) => {
    range = r;
    // Keep the choice in the address without triggering a full route re-render.
    try { history.replaceState(null, '', `#/analytics?range=${r}`); } catch { /* ignore */ }
    load(r);
  };

  return h('div', { class: 'grid gap-y-8' },
    pageHeader({
      title: 'Analytics',
      description: 'How each day played: rounds, scores against par and clicks on nods.',
      actions: segmented({ label: 'Date range', options: RANGES, value: range, onChange: onRange }),
    }),
    body);
}
