// Settings (owner only): organisation details, embed snippet, publishing, danger zone.
import { api } from '../api.mjs';
import { h, mount, pageHeader, section, field, input, button, descriptionList, confirmDialog, toast, busy, copyText, fmt } from '../ui.mjs';
import { publishNow, reloadMe } from '../app.mjs';

const HEX = /^#[0-9a-f]{6}$/i;
const DEFAULT_ACCENT = '#17845A';

const rule = () => h('hr', { class: 'border-zinc-950/5 dark:border-white/10' });

const twoCol = (left, right) => h('div', { class: 'grid gap-x-12 gap-y-6 lg:grid-cols-[2fr_3fr]' }, left, right);
const intro = (title, body) => h('div', { class: 'grid content-start gap-y-1' },
  h('h2', { class: 'text-base font-semibold text-balance text-zinc-950 sm:text-sm dark:text-white' }, title),
  h('p', { class: 'max-w-[50ch] text-base/6 text-pretty text-zinc-500 sm:text-sm/6 dark:text-zinc-400' }, body));

export default async function view({ me }) {
  const [{ org = {} }, dash] = await Promise.all([
    api('settings'),
    api('dashboard').catch(() => null),
  ]);
  const build = dash?.build || {};

  // ── Organisation ───────────────────────────────────────────────────────────
  const name = input({ name: 'org-name', value: org.name || '', required: true, autocomplete: 'organization' });
  const sponsor = input({ name: 'sponsor-label', value: org.sponsorLabel || '', placeholder: 'Presented by Example Bank' });
  const accentText = input({ name: 'accent', value: org.accent || DEFAULT_ACCENT, class: 'font-mono', maxlength: '7', spellcheck: 'false' });
  const accentPick = h('input', {
    type: 'color', name: 'accent-picker', 'aria-label': 'Pick accent colour', value: HEX.test(org.accent || '') ? org.accent : DEFAULT_ACCENT,
    class: 'size-9 shrink-0 cursor-pointer rounded-lg bg-white p-1 ring-1 ring-zinc-950/10 ring-inset focus-visible:outline-2 focus-visible:-outline-offset-1 focus-visible:outline-brand-600 dark:bg-white/5 dark:ring-white/10',
  });
  accentPick.addEventListener('input', () => { accentText.value = accentPick.value.toUpperCase(); fAccent.setError(null); });
  accentText.addEventListener('input', () => { if (HEX.test(accentText.value.trim())) accentPick.value = accentText.value.trim(); });

  const fName = field({ label: 'Organisation name', input: name, hint: 'Shown in the Backroom and on shared invite cards.' });
  const fSponsor = field({ label: 'Sponsor label', input: sponsor, hint: 'Optional. Leave blank for no sponsor line.' });
  // field() labels node.control, so the visible label lands on the hex text input (the picker has its own aria-label).
  const accentWrap = h('div', { class: 'flex items-center gap-x-3' }, accentPick, h('div', { class: 'min-w-0 flex-1' }, accentText));
  accentWrap.control = accentText;
  const fAccent = field({ label: 'Accent colour', input: accentWrap, hint: 'A hex value like #17845A.' });

  const save = button({ label: 'Save settings', variant: 'primary', type: 'submit' });
  const orgForm = h('form', { class: 'grid max-w-md gap-y-6', novalidate: true, 'on:submit': async (e) => {
    e.preventDefault();
    fName.setError(null); fAccent.setError(null);
    const accent = accentText.value.trim();
    if (!name.value.trim()) return fName.setError('Enter a name.');
    if (!HEX.test(accent)) return fAccent.setError('Use a six-digit hex colour, like #17845A.');
    try {
      await busy(save, () => api('settings_save', { name: name.value.trim(), accent: accent.toUpperCase(), sponsorLabel: sponsor.value.trim() }));
      toast('Settings saved.');
      reloadMe().catch(() => {});
    } catch (err) { toast(err.message, { tone: 'error' }); }
  } }, fName, fAccent, fSponsor, h('div', {}, save));

  // ── Embed ──────────────────────────────────────────────────────────────────
  const gameUrl = `${location.origin}/`;
  const snippet = `<iframe src="${gameUrl}" title="${(org.name ? `${org.name} Links` : 'Links').replace(/"/g, '&quot;')}" width="100%" height="760" style="border:0;max-width:480px" allow="clipboard-write; web-share" loading="lazy"></iframe>`;
  const embed = h('div', { class: 'grid gap-y-3' },
    h('pre', { class: 'overflow-x-auto rounded-lg bg-zinc-950/5 p-4 font-mono text-base/6 whitespace-pre-wrap sm:text-sm/6 text-zinc-800 select-all dark:bg-white/5 dark:text-zinc-200' }, snippet),
    h('div', { class: 'flex flex-wrap gap-2' },
      button({ label: 'Copy snippet', size: 'sm', icon: 'clipboard-document', onClick: () => copyText(snippet, 'Embed snippet copied.') }),
      button({ label: 'Open the game', size: 'sm', variant: 'ghost', icon: 'arrow-top-right-on-square', href: gameUrl, target: '_blank' })));

  // ── Publishing ─────────────────────────────────────────────────────────────
  const pubStatus = h('div');
  const renderPub = (b) => mount(pubStatus, descriptionList([
    ['Last publish', b.lastPublishAt ? h('time', { datetime: b.lastPublishAt, title: fmt.dateTime(b.lastPublishAt) }, `${fmt.rel(b.lastPublishAt)}, ${fmt.dateTime(b.lastPublishAt)}`) : 'Never'],
    ['Site built', b.builtAt ? h('time', { datetime: b.builtAt, title: fmt.dateTime(b.builtAt) }, fmt.rel(b.builtAt)) : '—'],
    ['Unpublished changes', h('span', { class: 'tabular-nums' }, fmt.num(b.unpublished ?? 0))],
  ]));
  renderPub(build);
  const pubBtn = button({ label: 'Publish now', icon: 'rocket-launch', onClick: async () => {
    if (await publishNow(pubBtn)) renderPub({ ...build, lastPublishAt: new Date().toISOString(), unpublished: 0 });
  } });

  // ── Danger zone ────────────────────────────────────────────────────────────
  const code = input({ name: 'player-code', placeholder: 'AB12', maxlength: '6', autocomplete: 'off', spellcheck: 'false', class: 'font-mono uppercase' });
  const fCode = field({ label: 'Player code', input: code, hint: 'The code shown in the player’s game settings.' });
  const delBtn = button({ label: 'Delete player', variant: 'danger', icon: 'trash', type: 'submit' });
  const dangerForm = h('form', { class: 'grid max-w-xs gap-y-4', novalidate: true, 'on:submit': async (e) => {
    e.preventDefault();
    fCode.setError(null);
    const c = code.value.toUpperCase().replace(/[\s-]/g, '');
    if (!/^[A-HJ-NP-Z2-9]{4}$/.test(c)) return fCode.setError('Player codes are 4 characters, letters and digits 2 to 9.');
    const ok = await confirmDialog({
      title: `Delete player ${c}?`,
      body: 'Their profile, rounds and streak are permanently deleted. This cannot be undone.',
      confirmLabel: 'Delete player',
      danger: true,
    });
    if (!ok) return;
    try {
      await busy(delBtn, () => api('delete_player', { code: c }));
      code.value = '';
      toast(`Player ${c} was deleted.`);
    } catch (err) { fCode.setError(err.message); }
  } }, fCode, h('div', {}, delBtn));

  return h('div', { class: 'grid gap-y-10' },
    pageHeader({ title: 'Settings', description: 'Organisation details, embedding and publishing.' }),
    twoCol(intro('Organisation', 'How your newsroom appears to staff and players.'), orgForm),
    rule(),
    twoCol(intro('Embed the game', 'Paste this into any page on your site to run the game inline.'), embed),
    rule(),
    twoCol(intro('Publishing', 'Calendar edits reach players after a publish. Nods go live as soon as they are saved. Publishing rebuilds the game; it takes a minute or two.'),
      h('div', { class: 'grid max-w-md gap-y-4' }, pubStatus, h('div', {}, pubBtn))),
    rule(),
    twoCol(intro('Danger zone', 'Delete a player who asked to have their data removed.'), dangerForm));
}
