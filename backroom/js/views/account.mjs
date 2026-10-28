// Account: who you are, and change your password.
import { api } from '../api.mjs';
import { h, pageHeader, section, descriptionList, field, input, button, badge, busy, toast } from '../ui.mjs';

const MIN_PW = 10;
const ROLE = { owner: ['Owner', 'brand'], editor: ['Editor', 'blue'], viewer: ['Viewer', 'neutral'] };

export default async function view({ me }) {
  const [roleLabel, roleTone] = ROLE[me?.role] || [me?.role || 'Staff', 'neutral'];

  const current = input({ type: 'password', name: 'current-password', autocomplete: 'current-password', required: true });
  const next = input({ type: 'password', name: 'new-password', autocomplete: 'new-password', required: true, minlength: String(MIN_PW) });
  const confirm = input({ type: 'password', name: 'confirm-password', autocomplete: 'new-password', required: true });
  const fCurrent = field({ label: 'Current password', input: current });
  const fNext = field({ label: 'New password', input: next, hint: `At least ${MIN_PW} characters.` });
  const fConfirm = field({ label: 'Confirm new password', input: confirm });
  const save = button({ label: 'Change password', variant: 'primary', type: 'submit' });

  const form = h('form', { class: 'grid max-w-xs gap-y-6', novalidate: true, 'on:submit': async (e) => {
    e.preventDefault();
    [fCurrent, fNext, fConfirm].forEach((f) => f.setError(null));
    if (!current.value) return fCurrent.setError('Enter your current password.');
    if (next.value.length < MIN_PW) return fNext.setError(`Use at least ${MIN_PW} characters.`);
    if (next.value.length > 200) return fNext.setError('Use 200 characters or fewer.');
    if (next.value !== confirm.value) return fConfirm.setError('The passwords do not match.');
    try {
      await busy(save, () => api('account_password', { current: current.value, next: next.value }));
      form.reset();
      toast('Password changed.');
    } catch (err) {
      if (err.status === 403) fCurrent.setError(err.message);
      else if (err.status === 400) fNext.setError(err.message);
      else toast(err.message, { tone: 'error' });
    }
  } }, fCurrent, fNext, fConfirm, h('div', {}, save));

  return h('div', { class: 'grid gap-y-10' },
    pageHeader({ title: 'Account', description: 'Your sign-in details for Links Backroom.' }),
    section({ title: 'Profile', description: 'Ask your team owner to change your name, email or role.' },
      descriptionList([
        ['Name', me?.name],
        ['Email', me?.email],
        ['Role', badge({ label: roleLabel, tone: roleTone })],
      ])),
    section({ title: 'Password', description: 'A long passphrase is easier to remember and harder to guess.' }, form));
}
