// Vercel Serverless — avviso email ticket MenuPro
// Env: RESEND_API_KEY, SUPPORT_EMAIL, NOTIFY_FROM

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.status(204).end(); return; }
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }
  try {
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body || '{}'); } catch (_) { body = {}; }
    }
    if (!body || typeof body !== 'object') body = {};

    // body.to ha priorità (es. email ristoratore); altrimenti SUPPORT_EMAIL admin
    const to = (body.to || process.env.SUPPORT_EMAIL || '').trim();
    const subject = (body.subject || 'MenuPro — notifica').trim();
    const text = body.text || '';
    if (!to) {
      res.status(200).json({ ok: true, emailed: false, reason: 'Nessun destinatario (to / SUPPORT_EMAIL)' });
      return;
    }
    const key = (process.env.RESEND_API_KEY || '').trim();
    if (!key) {
      res.status(200).json({ ok: true, emailed: false, reason: 'RESEND_API_KEY assente' });
      return;
    }
    const from = (process.env.NOTIFY_FROM || 'MenuPro <onboarding@resend.dev>').trim();
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(200).json({ ok: true, emailed: false, reason: j.message || j.error || ('HTTP ' + r.status), resend: j });
      return;
    }
    res.status(200).json({ ok: true, emailed: true, id: j.id || null });
  } catch (e) {
    res.status(200).json({ ok: true, emailed: false, reason: String((e && e.message) || e) });
  }
};
