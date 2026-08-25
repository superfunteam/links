// Proves the function runtime can reach the database. Used to validate the
// pipeline before the real endpoints are built on top of it.
import { getDatabase } from '@netlify/database';

export default async () => {
  try {
    const { sql, driver } = getDatabase();
    const rows = await sql`select now() as at, version() as version`;
    return Response.json({
      ok: true,
      driver,
      at: rows[0]?.at,
      postgres: String(rows[0]?.version || '').split(' ').slice(0, 2).join(' ')
    });
  } catch (err) {
    return Response.json({ ok: false, error: err.message }, { status: 500 });
  }
};

export const config = { path: '/api/health' };
