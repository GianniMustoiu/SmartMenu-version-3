// Vercel Serverless: avviso email nuovo ticket / messaggio
// Imposta in Vercel → Environment Variables:
//   RESEND_API_KEY=re_xxx
//   SUPPORT_EMAIL=tua@email.it
//   NOTIFY_FROM=MenuPro <onboarding@resend.dev>  (o dominio verificato)

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const to = process.env.SUPPORT_EMAIL || body.to;
    const subject = body.subject || 'MenuPro — nuovo ticket';
    const text = body.text || '';
    if (!to) {
      res.status(200).json({ ok: true, emailed: false, reason: 'SUPPORT_EMAIL non configurata' });
      return;
    }
    const key = process.env.RESEND_API_KEY;
    if (!key) {
      res.status(200).json({ ok: true, emailed: false, reason: 'RESEND_API_KEY assente — ticket salvato comunque' });
      return;
    }
    const from = process.env.NOTIFY_FROM || 'MenuPro <onboarding@resend.dev>';
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: 'Bearer ' + key,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ from, to: [to], subject, text })
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(200).json({ ok: true, emailed: false, reason: j.message || 'errore Resend' });
      return;
    }
    res.status(200).json({ ok: true, emailed: true });
  } catch (e) {
    res.status(200).json({ ok: true, emailed: false, reason: String(e && e.message || e) });
  }
};
