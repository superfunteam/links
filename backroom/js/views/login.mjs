// Sign-in, plus first-run owner setup when the staff table is empty.
// Rendered outside the shell: view({onSignedIn(data)}) → Node.
import { api } from '../api.mjs';
import { h, button, field, input, busy } from '../ui.mjs';

const MIN_PW = 10;

const frame = (...children) =>
  h('div', { class: 'flex min-h-dvh flex-col items-center justify-center bg-white px-4 py-12 sm:px-6 dark:bg-zinc-950' },
    h('div', { class: 'grid w-full max-w-xs gap-y-8' }, children));

const heading = (title, body) => h('div', { class: 'grid gap-y-2' },
  h('p', { class: 'flex items-baseline gap-x-1.5 text-base/7 tracking-tight' },
    h('span', { class: 'font-semibold text-zinc-950 dark:text-white' }, 'Links'),
    h('span', { class: 'font-medium text-zinc-500 dark:text-zinc-400' }, 'Backroom')),
  h('h1', { class: 'text-2xl font-semibold tracking-tight text-balance text-zinc-950 dark:text-white' }, title),
  body ? h('p', { class: 'text-base/6 text-pretty text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, body) : null);

const formError = () => h('p', { role: 'alert', class: 'text-base/6 text-red-600 sm:text-sm/6 dark:text-red-400', hidden: true });
const showErr = (el, msg) => { el.textContent = msg || ''; el.hidden = !msg; };

const signInForm = (onSignedIn) => {
  const email = input({ type: 'email', name: 'email', autocomplete: 'username', required: true, autofocus: true });
  const password = input({ type: 'password', name: 'password', autocomplete: 'current-password', required: true });
  const err = formError();
  const submit = button({ label: 'Sign in', variant: 'primary', type: 'submit', class: 'w-full' });
  const form = h('form', { class: 'grid gap-y-6', novalidate: true, 'on:submit': async (e) => {
    e.preventDefault();
    showErr(err, '');
    if (!email.value.trim() || !password.value) return showErr(err, 'Enter your email and password.');
    try {
      const data = await busy(submit, () => api('auth_login', { email: email.value.trim().toLowerCase(), password: password.value }));
      onSignedIn(data);
    } catch (ex) {
      password.value = '';
      showErr(err, ex.message || 'Those details did not work. Try again.');
      password.focus();
    }
  } },
    field({ label: 'Email', input: email }),
    field({ label: 'Password', input: password }),
    err,
    submit);
  return frame(
    heading('Sign in', 'Use the email and password your team owner gave you.'),
    form,
    h('p', { class: 'text-base/6 text-pretty text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, 'Forgot your password? Ask your team owner for help.'));
};

const setupForm = (onSignedIn) => {
  const key = input({ type: 'password', name: 'setupKey', autocomplete: 'off', required: true, autofocus: true });
  const name = input({ name: 'name', autocomplete: 'name', required: true });
  const email = input({ type: 'email', name: 'email', autocomplete: 'username', required: true });
  const password = input({ type: 'password', name: 'new-password', autocomplete: 'new-password', required: true, minlength: String(MIN_PW) });
  const pwField = field({ label: 'Password', input: password, hint: `At least ${MIN_PW} characters.` });
  const err = formError();
  const submit = button({ label: 'Create owner account', variant: 'primary', type: 'submit', class: 'w-full' });
  const form = h('form', { class: 'grid gap-y-6', novalidate: true, 'on:submit': async (e) => {
    e.preventDefault();
    showErr(err, ''); pwField.setError(null);
    if (!key.value || !name.value.trim() || !email.value.trim()) return showErr(err, 'Fill in every field.');
    if (password.value.length < MIN_PW) return pwField.setError(`Use at least ${MIN_PW} characters.`);
    try {
      const data = await busy(submit, () => api('auth_setup', {
        setupKey: key.value, name: name.value.trim(), email: email.value.trim().toLowerCase(), password: password.value,
      }));
      onSignedIn(data);
    } catch (ex) {
      showErr(err, ex.message);
    }
  } },
    field({ label: 'Setup key', input: key, hint: 'The BACKROOM_KEY value set in your Netlify environment.' }),
    field({ label: 'Your name', input: name }),
    field({ label: 'Email', input: email }),
    pwField,
    err,
    submit);
  return frame(heading('Set up Links Backroom', 'Create the owner account. You can invite editors and viewers once you are in.'), form);
};

export default async function view({ onSignedIn } = {}) {
  let needsSetup = false;
  try { needsSetup = !!(await api('auth_status')).needsSetup; } catch { /* fall back to sign-in */ }
  const node = needsSetup ? setupForm(onSignedIn) : signInForm(onSignedIn);
  requestAnimationFrame(() => node.querySelector('[autofocus]')?.focus());
  return node;
}
