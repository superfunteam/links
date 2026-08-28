// Runs on the hour, every hour. Each subscription fires when ITS timezone says
// it's 9am and it hasn't heard about today yet — so "9am daily, local time"
// needs no per-device scheduling, just this one sweep.
import webpush from 'web-push';
import { getDatabase } from '@netlify/database';
import { SCHEDULE } from '../lib/scheduledata.mjs';

const localParts = (tz) => {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, hour: 'numeric', hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit'
    }).formatToParts(new Date());
    const get = t => parts.find(p => p.type === t)?.value;
    return { hour: Number(get('hour')), date: `${get('year')}-${get('month')}-${get('day')}` };
  } catch { return null; }                        // an invalid tz never breaks the sweep
};

export default async () => {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { console.log('notify: VAPID keys missing'); return new Response('no keys'); }
  webpush.setVapidDetails('mailto:clark@superfun.team', pub, priv);

  const { sql } = getDatabase();
  const subs = await sql`select endpoint, keys, tz, last_sent::text as last_sent from push_subs`;
  let sent = 0, dropped = 0;
  for (const s of subs) {
    const at = localParts(s.tz);
    if (!at || at.hour !== 9 || s.last_sent === at.date) continue;
    const day = SCHEDULE.days.find(d => d.date === at.date);
    const par = day ? day.holes.reduce((t, h) => { const b = h.words.length - 1; return t + b + (b >= 4 ? 2 : 1); }, 0) : null;
    const payload = JSON.stringify({
      title: 'Links ⛳',
      body: day ? `${day.name} is open — 5 holes, par ${par}. Coffee first, then golf.`
                : 'A new course is open. Come play your round!',
      url: '/'
    });
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, payload);
      await sql`update push_subs set last_sent = ${at.date}::date where endpoint = ${s.endpoint}`;
      sent++;
    } catch (err) {
      // 404/410 mean the browser revoked the subscription — it's dead, remove it
      if (err.statusCode === 404 || err.statusCode === 410) {
        await sql`delete from push_subs where endpoint = ${s.endpoint}`;
        dropped++;
      } else {
        console.log('notify: send failed', s.endpoint.slice(0, 40), err.statusCode || err.message);
      }
    }
  }
  console.log(`notify: ${subs.length} sub(s), ${sent} sent, ${dropped} dropped`);
  return new Response(`sent ${sent}`);
};

export const config = { schedule: '0 * * * *' };
