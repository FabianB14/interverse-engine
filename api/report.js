/**
 * Bug report relay — Vercel serverless function.
 *
 * The site's /report/ form POSTs here; we forward the report as an embed to
 * the Interverse Discord's bug-reports channel via a webhook. The webhook
 * URL lives in the DISCORD_WEBHOOK_URL env var (Vercel → Project →
 * Settings → Environment Variables), NEVER in the public page — a webhook
 * in shipped HTML would let anyone spam the channel directly.
 *
 * Kid-safe & anonymous by default: nothing is required beyond the
 * description; contact is optional and clearly labeled.
 */

const MAX = { game: 40, title: 120, details: 1800, steps: 900, device: 200, contact: 120 };

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, error: 'POST only' });
    return;
  }
  const hook = process.env.DISCORD_WEBHOOK_URL;
  if (!hook) {
    res.status(503).json({ ok: false, error: 'report relay not configured' });
    return;
  }

  const b = typeof req.body === 'object' && req.body !== null ? req.body : {};
  // Honeypot: real users never fill the invisible "website" field.
  if (b.website) {
    res.status(200).json({ ok: true });
    return;
  }
  const clip = (v, n) =>
    String(v ?? '')
      .trim()
      .slice(0, n);
  const game = clip(b.game, MAX.game) || 'Not sure';
  const title = clip(b.title, MAX.title);
  const details = clip(b.details, MAX.details);
  const steps = clip(b.steps, MAX.steps);
  const device = clip(b.device, MAX.device);
  const contact = clip(b.contact, MAX.contact);
  if (!details && !title) {
    res.status(400).json({ ok: false, error: 'tell us what happened' });
    return;
  }

  const fields = [{ name: 'Where', value: game, inline: true }];
  if (device) fields.push({ name: 'Device', value: device, inline: true });
  if (steps) fields.push({ name: 'Steps to reproduce', value: steps });
  if (contact) fields.push({ name: 'Contact (optional)', value: contact });

  const r = await fetch(hook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      username: 'Interverse Bug Reports',
      embeds: [
        {
          title: `🐛 ${title || details.slice(0, 100)}`,
          description: details,
          color: 0xff5d73,
          fields,
          footer: { text: 'via interverseengine.com/report' },
          timestamp: new Date().toISOString(),
        },
      ],
    }),
  });
  if (!r.ok) {
    res.status(502).json({ ok: false, error: 'could not reach Discord' });
    return;
  }
  res.status(200).json({ ok: true });
}
