// The schedule only extends when the site builds, so a quiet week of no deploys
// once let the calendar run dry. One build a day keeps the horizon full.
export default async () => {
  const hook = process.env.BUILD_HOOK_URL;
  if (!hook) { console.log('daily-build: BUILD_HOOK_URL missing'); return new Response('no hook'); }
  const res = await fetch(`${hook}?trigger_title=daily+schedule+refresh`, { method: 'POST' });
  console.log('daily-build: hook', res.status);
  return new Response(`hook ${res.status}`);
};

// 05:00 UTC is just after midnight Eastern, after the day rolls over.
export const config = { schedule: '0 5 * * *' };
