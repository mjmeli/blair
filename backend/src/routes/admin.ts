import { Router } from 'express';
import { getStats } from '../services/stats.js';
import { store } from '../services/store.js';

const router = Router();

/** Owner-only endpoints, guarded by ADMIN_KEY (set on the server, passed as ?key=). */
function requireAdmin(req: any, res: any, next: any): void {
  const key = process.env.ADMIN_KEY;
  if (!key || req.query.key !== key) {
    res.status(404).json({ error: 'not_found', message: 'No such API route' });
    return;
  }
  next();
}

// Daily usage counters, newest first. Plain HTML by default so it reads well on a phone; ?format=json for data.
router.get('/stats', requireAdmin, async (req, res) => {
  try {
    const days = Math.min(parseInt(String(req.query.days)) || 14, 90);
    const rows = await getStats(days);
    const totals = rows.reduce(
      (t, r) => ({ page_views: t.page_views + r.page_views, unique_visitors: t.unique_visitors + r.unique_visitors, logins: t.logins + r.logins, active_babies: t.active_babies + r.active_babies }),
      { page_views: 0, unique_visitors: 0, logins: 0, active_babies: 0 },
    );
    if (req.query.format === 'json') { res.json({ days, totals, rows }); return; }
    const tr = (r: any) => `<tr><td>${r.day}</td><td>${r.page_views}</td><td>${r.unique_visitors}</td><td>${r.logins}</td><td>${r.active_babies}</td></tr>`;
    res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>blAIr stats</title>
<style>body{font:15px system-ui;margin:24px;color:#111}table{border-collapse:collapse;width:100%;max-width:640px}td,th{padding:8px 10px;border-bottom:1px solid #ddd;text-align:right}td:first-child,th:first-child{text-align:left}th{font-size:12px;color:#666;text-transform:uppercase}tfoot td{font-weight:600}</style>
<h2>blAIr usage, last ${days} days</h2>
<table><thead><tr><th>Day (UTC)</th><th>Page views</th><th>Visitors</th><th>Logins</th><th>Active babies</th></tr></thead>
<tbody>${rows.map(tr).join('') || '<tr><td colspan=5>No data yet</td></tr>'}</tbody>
<tfoot>${tr({ day: 'Total', ...totals })}</tfoot></table>
<p style="color:#666;font-size:13px">Visitors are counted by a daily-rotating hash of IP + browser; no cookies. Active babies = distinct Nanit babies whose dashboard loaded.</p>`);
  } catch (err: any) {
    res.status(500).json({ error: 'stats_failed', message: err.message });
  }
});

// Recent feedback submissions, newest first.
router.get('/feedback', requireAdmin, async (req, res) => {
  try {
    const items = await store.getFeedback(50);
    if (req.query.format === 'json') { res.json({ items }); return; }
    const esc = (s: unknown) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string));
    res.type('html').send(`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>blAIr feedback</title>
<style>body{font:15px system-ui;margin:24px;color:#111;max-width:720px}article{border-bottom:1px solid #ddd;padding:12px 0}small{color:#666}</style>
<h2>Feedback (${items.length})</h2>
${items.map((f: any) => `<article><small>${new Date(f.created_at).toLocaleString()} · ${esc(f.kind)} · ${esc(f.email || 'no email')} · ${esc(f.page)}</small><p>${esc(f.message)}</p></article>`).join('') || '<p>Nothing yet.</p>'}`);
  } catch (err: any) {
    res.status(500).json({ error: 'feedback_failed', message: err.message });
  }
});

export default router;
