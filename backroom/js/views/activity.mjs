// Activity: the audit log, newest first, 50 per page.
import { api } from '../api.mjs';
import { h, mount, pageHeader, table, button, busy, toast, fmt, emptyState } from '../ui.mjs';

const ACTIONS = {
  auth_setup: 'Created the owner account',
  auth_login: 'Signed in',
  auth_logout: 'Signed out',
  account_password: 'Changed password',
  day_save: 'Saved a day',
  nod_save: 'Saved a nod',
  nod_delete: 'Removed a nod',
  puzzle_create: 'Created a puzzle',
  puzzle_update: 'Updated a puzzle',
  puzzle_archive: 'Archived a puzzle',
  publish: 'Published',
  team_invite: 'Invited a teammate',
  team_update: 'Updated a teammate',
  team_remove: 'Removed a teammate',
  settings_save: 'Updated settings',
  player_delete: 'Deleted a player',
  publish_failed: 'Publish failed',
  freeze: 'Froze a day',
  refreeze: 'Refroze a day',
};

// Server audit actions use dotted names (day.save); accept underscores too.
export const actionLabel = (a) => {
  const key = String(a || '').replace(/\./g, '_');
  return ACTIONS[key] || key.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());
};

// A short, human summary of the detail JSON (never the raw blob).
export const detailSummary = (d) => {
  if (d == null) return '';
  if (typeof d !== 'object') return String(d);
  return Object.entries(d)
    .filter(([, v]) => v != null && typeof v !== 'object')
    .slice(0, 4)
    .map(([k, v]) => `${k.replace(/_/g, ' ')}: ${v}`)
    .join(' · ');
};

const targetLink = (t) => {
  if (!t) return '—';
  const m = /^(\d{4}-\d{2}-\d{2})(?:#(\d+))?$/.exec(t);
  if (m) return h('a', { href: `#/day/${m[1]}`, class: 'font-medium text-zinc-950 underline decoration-zinc-950/20 underline-offset-4 hover:decoration-zinc-950 dark:text-white dark:decoration-white/20 dark:hover:decoration-white' }, m[2] ? `${fmt.date(m[1])}, hole ${m[2]}` : fmt.date(m[1]));
  return t;
};

export const activityColumns = [
  { key: 'at', label: 'When', render: (r) => h('time', { datetime: r.at, title: fmt.dateTime(r.at) }, fmt.rel(r.at)) },
  { key: 'actor', label: 'Who', render: (r) => h('span', { class: 'font-medium text-zinc-950 dark:text-white' }, r.actor || 'System') },
  { key: 'action', label: 'Action', render: (r) => actionLabel(r.action) },
  { key: 'target', label: 'Target', render: (r) => targetLink(r.target) },
  { key: 'detail', label: 'Details', render: (r) => h('span', { class: 'block max-w-[40ch] truncate text-zinc-500 dark:text-zinc-400', title: detailSummary(r.detail) }, detailSummary(r.detail) || '—') },
];

export default async function view() {
  const first = await api('activity');
  let items = first.items || [];
  let next = first.next ?? null;

  const tableWrap = h('div');
  const more = h('div', { class: 'flex justify-center' });

  const render = () => {
    if (!items.length) {
      mount(tableWrap, emptyState({ title: 'No activity yet', body: 'Edits, publishes and team changes show up here.' }));
      more.replaceChildren();
      return;
    }
    mount(tableWrap, table({ columns: activityColumns, rows: items }));
    if (next) {
      const btn = button({ label: 'Load older activity', onClick: async () => {
        try {
          const page = await busy(btn, () => api('activity', { before: next }));
          items = items.concat(page.items || []);
          next = page.next ?? null;
          render();
        } catch (err) { toast(err.message, { tone: 'error' }); }
      } });
      mount(more, btn);
    } else {
      mount(more, h('p', { class: 'text-base/6 text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, 'That is everything.'));
    }
  };
  render();

  return h('div', { class: 'grid gap-y-8' },
    pageHeader({ title: 'Activity', description: 'Every change made in the Backroom, newest first.' }),
    tableWrap,
    more);
}
