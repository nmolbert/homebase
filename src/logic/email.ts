// Email via Resend. Optional: if RESEND_API_KEY is not set, sends are skipped
// and the app reports that on the Settings page.
export interface EmailEnv { RESEND_API_KEY?: string; EMAIL_FROM?: string }

export function emailConfigured(env: EmailEnv) { return !!env.RESEND_API_KEY; }

export async function sendEmail(env: EmailEnv, to: string[], subject: string, html: string, text: string) {
  if (!env.RESEND_API_KEY) return { ok: false, skipped: true, reason: "RESEND_API_KEY not set" };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: env.EMAIL_FROM || "Home Base <onboarding@resend.dev>", to, subject, html, text }),
  });
  const body = await res.text();
  return { ok: res.ok, status: res.status, body: body.slice(0, 300) };
}

// Gmail strips background CSS on buttons, so links are bordered text, not
// filled buttons.
export function renderDigest(title: string, intro: string, items: { title: string; body: string; link: string }[], baseUrl: string) {
  const esc = (s: string) => String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const rows = items.map((i) =>
    `<tr><td style="padding:10px 0;border-bottom:1px solid #e6e2d8;font-family:-apple-system,Helvetica,Arial,sans-serif">
      <div style="font-weight:600;color:#1c2a24;font-size:15px">${esc(i.title)}</div>
      <div style="color:#5a635e;font-size:13px;margin-top:2px">${esc(i.body)}</div>
      <div style="margin-top:6px"><a href="${baseUrl}/${i.link}" style="color:#1f6f5b;font-size:13px">Open in Home Base →</a></div>
    </td></tr>`).join("");
  const html = `<div style="max-width:560px;margin:0 auto;padding:24px;font-family:-apple-system,Helvetica,Arial,sans-serif;color:#1c2a24">
    <div style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#1f6f5b;font-weight:700">Home Base</div>
    <h1 style="font-size:20px;margin:6px 0 4px">${esc(title)}</h1>
    <p style="color:#5a635e;font-size:14px;margin:0 0 12px">${esc(intro)}</p>
    <table style="width:100%;border-collapse:collapse">${rows}</table>
    <p style="margin-top:20px"><a href="${baseUrl}" style="display:inline-block;border:2px solid #1f6f5b;color:#1f6f5b;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">Open Home Base</a></p>
  </div>`;
  const text = `${title}\n${intro}\n\n` + items.map((i) => `• ${i.title}\n  ${i.body}\n  ${baseUrl}/${i.link}`).join("\n\n") + `\n\n${baseUrl}`;
  return { html, text };
}
