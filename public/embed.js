/**
 * #50 — Embeddable roast badge/widget for agency sites.
 * Usage:
 * <div data-rmp-url="https://example.com"></div>
 * <script src="https://roastmypage.site/embed.js" async></script>
 */
(function () {
  const API = (document.currentScript && document.currentScript.getAttribute("data-api")) || "";
  async function mount(el) {
    const target = el.getAttribute("data-rmp-url");
    if (!target) return;
    el.innerHTML = '<span style="font:12px/1.4 system-ui">Loading roast…</span>';
    try {
      const res = await fetch(`${API}/api/v1/roast`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: target, device: "desktop" })
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.message || "Failed");
      const score = data.scores?.overall ?? "-";
      const share = data.shareUrl || "#";
      el.innerHTML = `
        <a href="${share}" target="_blank" rel="noopener"
           style="display:inline-flex;align-items:center;gap:8px;padding:8px 12px;border-radius:10px;
                  background:#0A0908;color:#F5F0E8;text-decoration:none;font:600 13px/1 Syne,system-ui,sans-serif;border:1px solid rgba(245,240,232,.12)">
          <span style="color:#E85D04;font-size:18px">${score}</span>
          <span>/10 roast</span>
        </a>`;
    } catch (e) {
      el.innerHTML = '<span style="font:12px system-ui;color:#888">Roast unavailable</span>';
    }
  }
  function boot() {
    document.querySelectorAll("[data-rmp-url]").forEach(mount);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
})();
