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

/* ── the phrase book ──
   A reminder is an intro (the title) plus one mention (the body): the streak
   when it's alive, a clubmate who already played, or the day's course. Random
   picks keep 9am from sounding like a form letter. */
const INTROS = [
  'Tee time \u26f3',
  'The course is open',
  'Fresh links today',
  'Morning, golfer',
  'New day, new chain',
  'Your round awaits',
  'Five holes, one coffee',
  'The flags are out',
  'Cart\u2019s warmed up \u26f3',
  'Today\u2019s course is live',
];
const days = n => n === 1 ? '1 day' : `${n} days`;
const STREAKS = [
  n => `Your ${n}-day streak is one round from ${n + 1}.`,
  n => `Day ${n + 1} of the streak starts now.`,
  n => `${days(n)} running. Keep the chain unbroken.`,
  n => `That ${n}-day streak won\u2019t extend itself.`,
  n => `Streak check: ${days(n)} and counting.`,
  n => `${days(n)} straight. Make it one more.`,
  n => `The streak stands at ${n}. Defend it.`,
  n => `${days(n)} in a row so far. Today keeps it alive.`,
  n => `Your streak hits ${n + 1} the moment you card today\u2019s round.`,
  n => `${days(n)} deep. No time to stop now.`,
];
const FRIENDS = [
  f => `${f} already played today. You\u2019re on the tee.`,
  f => `${f} has posted a score. Answer it.`,
  f => `${f} beat you to the course this morning.`,
  f => `There\u2019s a score from ${f} on the board already.`,
  f => `${f} played. The clubhouse awaits your reply.`,
  f => `${f} is in with a score. Your move.`,
  f => `Card\u2019s open \u2014 ${f} has already signed in.`,
  f => `${f} teed off before breakfast. Catch up.`,
  f => `The leaderboard has ${f} on it. It\u2019s missing you.`,
  f => `${f} finished their round. Yours is waiting.`,
];
// display-only, same as the client: a trailing single initial gets its period
const dotName = n => /\s[A-Za-z]$/.test(n) ? n + '.' : n;
const pick = (arr, rand) => arr[Math.floor(rand() * arr.length)];

export const composeReminder = ({ streak = 0, friend = null, day = null, par = null, rand = Math.random } = {}) => {
  const title = pick(INTROS, rand);
  let body;
  if (friend && streak >= 1) body = rand() < 0.5 ? pick(FRIENDS, rand)(dotName(friend)) : pick(STREAKS, rand)(streak);
  else if (friend)           body = pick(FRIENDS, rand)(dotName(friend));
  else if (streak >= 1)      body = pick(STREAKS, rand)(streak);
  else body = day ? `${day} is open \u2014 5 holes, par ${par}. Coffee first, then golf.`
                  : 'A new course is open. Come play your round!';
  return { title, body };
};

// walking a YYYY-MM-DD key backwards, anchored at noon UTC so DST can't skip a day
const prevDay = k => { const t = new Date(k + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };
const streakOf = (dates, today) => {
  const have = new Set(dates);
  let k = have.has(today) ? today : prevDay(today);
  let n = 0;
  while (have.has(k)) { n++; k = prevDay(k); }
  return n;
};

export default async () => {
  const pub = process.env.VAPID_PUBLIC_KEY, priv = process.env.VAPID_PRIVATE_KEY;
  if (!pub || !priv) { console.log('notify: VAPID keys missing'); return new Response('no keys'); }
  webpush.setVapidDetails('mailto:clark@superfun.team', pub, priv);

  const { sql } = getDatabase();
  const subs = await sql`select endpoint, keys, tz, player_id, last_sent::text as last_sent from push_subs`;
  const etToday = localParts('America/New_York')?.date;
  let sent = 0, dropped = 0;
  for (const s of subs) {
    const at = localParts(s.tz);
    if (!at || at.hour !== 9 || s.last_sent === at.date) continue;
    const day = SCHEDULE.days.find(d => d.date === at.date);
    const par = day ? day.holes.reduce((t, h) => { const b = h.words.length - 1; return t + b + (b >= 4 ? 2 : 1); }, 0) : null;

    // what's true for THIS player this morning: their streak, and any clubmate
    // who has already put up a score today (rounds are kept on ET dates)
    let streak = 0, friend = null;
    if (s.player_id && etToday) {
      try {
        const mine = await sql`select play_date::text as d from rounds
          where player_id = ${s.player_id} order by play_date desc limit 60`;
        streak = streakOf(mine.map(r => r.d), etToday);
        const played = await sql`select p.name from rounds r
          join players p on p.id = r.player_id
          where r.play_date = ${etToday}::date and p.name is not null
            and r.player_id in (
              select case when low_id = ${s.player_id} then high_id else low_id end
              from friendships where low_id = ${s.player_id} or high_id = ${s.player_id})`;
        if (played.length) friend = played[Math.floor(Math.random() * played.length)].name;
      } catch (err) { console.log('notify: personalize failed', err.message); }
    }
    const msg = composeReminder({ streak, friend, day: day?.name, par });
    const payload = JSON.stringify({ title: msg.title, body: msg.body, url: '/' });
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
