// Team (owner only): members, roles, invites, disable/remove.
import { api } from '../api.mjs';
import { h, mount, pageHeader, table, badge, button, select, field, input, dialog, confirmDialog, toast, busy, copyText, fmt, emptyState } from '../ui.mjs';

const ROLES = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' },
  { value: 'owner', label: 'Owner' },
];
const ROLE_HELP = 'Viewers can look around. Editors can also change days, puzzles and nods, and publish. Owners can also manage the team and settings.';

const inviteDialog = (onDone) => {
  const name = input({ name: 'name', autocomplete: 'off', required: true });
  const email = input({ type: 'email', name: 'email', autocomplete: 'off', required: true });
  const role = select({ name: 'role', value: 'editor' }, ROLES);
  const fName = field({ label: 'Name', input: name });
  const fEmail = field({ label: 'Email', input: email });
  const send = button({ label: 'Invite', variant: 'primary', type: 'submit' });
  const cancel = button({ label: 'Cancel', onClick: () => d.close() });
  const formErr = h('p', { role: 'alert', class: 'text-base/6 text-red-600 sm:text-sm/6 dark:text-red-400', hidden: true });

  const form = h('form', { class: 'grid gap-y-6', novalidate: true, 'on:submit': async (e) => {
    e.preventDefault();
    fName.setError(null); fEmail.setError(null); formErr.hidden = true;
    if (!name.value.trim()) return fName.setError('Enter a name.');
    if (!/^\S+@\S+\.\S+$/.test(email.value.trim())) return fEmail.setError('Enter a valid email address.');
    try {
      const res = await busy(send, () => api('team_invite', { name: name.value.trim(), email: email.value.trim().toLowerCase(), role: role.value }));
      d.close();
      onDone();
      showTempPassword(res.member, res.tempPassword);
    } catch (err) { formErr.textContent = err.message; formErr.hidden = false; }
  } },
    fName, fEmail,
    field({ label: 'Role', input: role, hint: ROLE_HELP }),
    formErr,
    h('div', { class: 'flex flex-col-reverse gap-3 sm:flex-row sm:justify-end' }, cancel, send));

  const d = dialog({ title: 'Invite a teammate', description: 'They get a temporary password to sign in with. Share it with them privately.', body: form });
};

const showTempPassword = (member, pw) => {
  const code = h('code', { class: 'block min-w-0 flex-1 truncate rounded-lg bg-zinc-950/5 px-3 py-2 font-mono text-base/6 text-zinc-950 select-all sm:py-1.5 sm:text-sm/6 dark:bg-white/10 dark:text-white' }, pw || '');
  dialog({
    title: `${member?.name || 'Your teammate'} can sign in now`,
    description: 'This temporary password is shown once. Copy it and send it to them privately. They can change it from their Account page.',
    body: h('div', { class: 'grid gap-y-3' },
      h('div', { class: 'text-base/6 text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, member?.email || ''),
      h('div', { class: 'flex items-center gap-x-2' }, code,
        button({ icon: 'clipboard-document', 'aria-label': 'Copy password', title: 'Copy password', onClick: () => copyText(pw, 'Password copied.') }))),
    actions: [{ label: 'Done', variant: 'primary' }],
  });
};

export default async function view({ me }) {
  const wrap = h('div');

  const load = async () => {
    const { members = [] } = await api('team');
    const owners = members.filter((m) => m.role === 'owner' && !m.disabled).length;

    const columns = [
      { key: 'name', label: 'Name', render: (m) => h('div', { class: 'min-w-0' },
        h('div', { class: 'flex items-center gap-x-2 font-medium text-zinc-950 dark:text-white' }, m.name,
          m.id === me?.id ? badge({ label: 'You', tone: 'neutral' }) : null),
        h('div', { class: 'text-zinc-500 dark:text-zinc-400' }, m.email)) },
      { key: 'role', label: 'Role', render: (m) => {
        if (m.id === me?.id) return badge({ label: ROLES.find((r) => r.value === m.role)?.label || m.role, tone: 'brand' });
        const s = select({ name: `role-${m.id}`, value: m.role, 'aria-label': `Role for ${m.name}`, class: 'min-w-32', 'on:change': async () => {
          const prev = m.role;
          try {
            await api('team_update', { id: m.id, role: s.value });
            m.role = s.value;
            toast(`${m.name} is now ${ROLES.find((r) => r.value === s.value)?.label.toLowerCase()}.`);
          } catch (err) { s.value = prev; toast(err.message, { tone: 'error' }); }
        } }, ROLES);
        return h('div', { class: 'w-36' }, s);
      } },
      { key: 'status', label: 'Status', render: (m) => (m.disabled ? badge({ label: 'Disabled', tone: 'red' }) : badge({ label: 'Active', tone: 'brand' })) },
      { key: 'lastSeen', label: 'Last seen', render: (m) => h('span', { title: m.lastSeen ? fmt.dateTime(m.lastSeen) : '' }, m.lastSeen ? fmt.rel(m.lastSeen) : 'Never') },
      { key: 'actions', label: '', align: 'right', render: (m) => {
        if (m.id === me?.id) return '';
        const lastOwner = m.role === 'owner' && !m.disabled && owners <= 1;
        const toggleBtn = button({
          label: m.disabled ? 'Enable' : 'Disable', size: 'sm', variant: 'ghost', disabled: lastOwner,
          onClick: async () => {
            try {
              await busy(toggleBtn, () => api('team_update', { id: m.id, disabled: !m.disabled }));
              toast(m.disabled ? `${m.name} can sign in again.` : `${m.name} can no longer sign in.`);
              await render();
            } catch (err) { toast(err.message, { tone: 'error' }); }
          },
        });
        const removeBtn = button({
          label: 'Remove', size: 'sm', variant: 'danger', disabled: lastOwner,
          onClick: async () => {
            const ok = await confirmDialog({ title: `Remove ${m.name}?`, body: 'They lose access right away. Their past activity stays in the log.', confirmLabel: 'Remove', danger: true });
            if (!ok) return;
            try {
              await busy(removeBtn, () => api('team_remove', { id: m.id }));
              toast(`${m.name} was removed.`);
              await render();
            } catch (err) { toast(err.message, { tone: 'error' }); }
          },
        });
        return h('div', { class: 'flex justify-end gap-x-2' }, toggleBtn, removeBtn);
      } },
    ];
    return members.length
      ? table({ columns, rows: members })
      : emptyState({ title: 'No teammates yet', body: 'Invite editors to help plan the calendar.' });
  };

  const render = async () => {
    try { mount(wrap, await load()); }
    catch (err) { toast(err.message, { tone: 'error' }); }
  };
  mount(wrap, await load());

  return h('div', { class: 'grid gap-y-8' },
    pageHeader({
      title: 'Team',
      description: ROLE_HELP,
      actions: button({ label: 'Invite teammate', variant: 'primary', icon: 'user-plus', onClick: () => inviteDialog(render) }),
    }),
    wrap);
}
