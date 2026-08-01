/**
 * Optional transactional email via Resend (#47 / #79).
 * When RESEND_API_KEY is unset, calls no-op and return { sent: false }.
 */
export async function sendEmail(env, { to, subject, html, text }) {
  if (!env.RESEND_API_KEY) {
    return { sent: false, reason: "RESEND_API_KEY not configured" };
  }
  const from = env.EMAIL_FROM || "Roast My Page <noreply@roastmypage.site>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from, to, subject, html, text })
    });
    if (!res.ok) {
      const body = await res.text();
      console.error("Resend error", res.status, body);
      return { sent: false, reason: `provider_${res.status}` };
    }
    const data = await res.json();
    return { sent: true, id: data.id };
  } catch (err) {
    console.error("Email send failed", err);
    return { sent: false, reason: "network_error" };
  }
}

export function roastSummaryHtml({ url, score, shareUrl }) {
  return `<div style="font-family:system-ui,sans-serif;line-height:1.5">
    <h2>Your roast is ready</h2>
    <p><strong>${score}/10</strong> for <a href="${url}">${url}</a></p>
    <p><a href="${shareUrl}">View full report</a></p>
  </div>`;
}
