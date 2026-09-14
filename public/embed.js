(function () {
  "use strict";

  var DEFAULT_ORIGIN = "https://roastmypage.site";
  var ALLOWED_HOSTS = {
    "roastmypage.site": true,
    "www.roastmypage.site": true,
    "localhost": true,
    "127.0.0.1": true
  };

  function currentScript() {
    return document.currentScript || document.querySelector('script[src*="/embed.js"]');
  }

  function cleanOrigin(value) {
    if (!value) return DEFAULT_ORIGIN;
    try {
      var parsed = new URL(value, DEFAULT_ORIGIN);
      var isLocal = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1";
      var protocolAllowed = parsed.protocol === "https:" || (isLocal && parsed.protocol === "http:");
      if (!protocolAllowed || !ALLOWED_HOSTS[parsed.hostname]) return DEFAULT_ORIGIN;
      return parsed.origin;
    } catch (_) {
      return DEFAULT_ORIGIN;
    }
  }

  function cleanText(value, fallback) {
    return String(value || fallback || "").replace(/[<>]/g, "").slice(0, 80);
  }

  function cleanMode(value) {
    return value === "iframe" ? "iframe" : "shadow";
  }

  function buildTargetUrl(origin, pageUrl) {
    var target = new URL("/", origin);
    target.searchParams.set("embed", "1");
    if (pageUrl) target.searchParams.set("url", pageUrl);
    return target.toString();
  }

  function normalizePageUrl(value) {
    var raw = String(value || "").trim();
    if (!raw) return "";
    if (!/^https?:\/\//i.test(raw)) raw = "https://" + raw;
    try {
      var parsed = new URL(raw);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
      return parsed.toString();
    } catch (_) {
      return "";
    }
  }

  function mountIframe(container, config) {
    var iframe = document.createElement("iframe");
    iframe.title = "Roast My Landing Page widget";
    iframe.loading = "lazy";
    iframe.referrerPolicy = "strict-origin-when-cross-origin";
    iframe.src = config.origin + "/embed?agency=" + encodeURIComponent(config.agency) + "&cta=" + encodeURIComponent(config.cta);
    iframe.style.cssText = "width:100%;min-height:220px;border:0;border-radius:18px;overflow:hidden;background:transparent;";
    container.appendChild(iframe);
  }

  function mountShadow(container, config) {
    var root = container.attachShadow ? container.attachShadow({ mode: "open" }) : container;
    var wrapper = document.createElement("div");
    wrapper.innerHTML =
      '<style>' +
      ':host{all:initial}.rmp-card,.rmp-card *{box-sizing:border-box}.rmp-card{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;width:100%;max-width:420px;border:1px solid rgba(12,10,9,.12);border-radius:18px;background:#0c0a09;color:#faf7f2;padding:18px;box-shadow:0 18px 50px rgba(12,10,9,.16)}' +
      '.rmp-eyebrow{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:rgba(250,247,242,.48);margin-bottom:8px}.rmp-title{font-size:20px;line-height:1.1;font-weight:800;letter-spacing:-.04em;margin:0 0 6px}.rmp-copy{font-size:13px;line-height:1.45;color:rgba(250,247,242,.62);margin:0 0 14px}.rmp-form{display:flex;gap:8px}.rmp-input{min-width:0;flex:1;border:1px solid rgba(250,247,242,.14);background:rgba(250,247,242,.06);border-radius:12px;color:#fff;font:inherit;font-size:14px;padding:12px;outline:none}.rmp-input:focus{border-color:rgba(232,93,4,.7);box-shadow:0 0 0 3px rgba(232,93,4,.18)}.rmp-input::placeholder{color:rgba(250,247,242,.34)}.rmp-button{border:0;border-radius:12px;background:#e85d04;color:#0c0a09;font:inherit;font-size:14px;font-weight:800;padding:12px 14px;cursor:pointer;white-space:nowrap}.rmp-button:hover{background:#ff6b1a}.rmp-error{display:none;margin-top:10px;color:#fecaca;font-size:12px}.rmp-powered{display:block;margin-top:12px;color:rgba(250,247,242,.35);font-size:11px;text-decoration:none}' +
      '@media(max-width:420px){.rmp-form{flex-direction:column}.rmp-button{width:100%}}' +
      '</style>' +
      '<section class="rmp-card" aria-label="Landing page roast widget">' +
      '<div class="rmp-eyebrow">' + config.agency + '</div>' +
      '<h2 class="rmp-title">Get a free landing page roast</h2>' +
      '<p class="rmp-copy">Paste a URL for conversion, SEO, speed, and AI heatmap feedback.</p>' +
      '<form class="rmp-form">' +
      '<input class="rmp-input" type="url" inputmode="url" placeholder="https://yoursite.com" aria-label="Landing page URL">' +
      '<button class="rmp-button" type="submit">' + config.cta + '</button>' +
      '</form>' +
      '<div class="rmp-error" role="alert">Enter a valid http or https URL.</div>' +
      '<a class="rmp-powered" href="' + config.origin + '/?embed=1" target="_blank" rel="noopener">Powered by Roast My Landing Page</a>' +
      '</section>';

    var form = wrapper.querySelector("form");
    var input = wrapper.querySelector("input");
    var error = wrapper.querySelector(".rmp-error");
    form.addEventListener("submit", function (event) {
      event.preventDefault();
      var pageUrl = normalizePageUrl(input.value);
      if (!pageUrl) {
        error.style.display = "block";
        input.focus();
        return;
      }
      error.style.display = "none";
      window.open(buildTargetUrl(config.origin, pageUrl), "_blank", "noopener");
    });
    root.appendChild(wrapper);
  }

  function init(script) {
    var config = {
      origin: cleanOrigin(script.getAttribute("data-origin") || script.src),
      mode: cleanMode(script.getAttribute("data-mode")),
      agency: cleanText(script.getAttribute("data-agency"), "Agency audit"),
      cta: cleanText(script.getAttribute("data-cta"), "Roast it")
    };
    var selector = script.getAttribute("data-target");
    var container = selector ? document.querySelector(selector) : null;
    if (!container) {
      container = document.createElement("div");
      script.parentNode.insertBefore(container, script.nextSibling);
    }
    container.setAttribute("data-roastmypage-widget", "");
    if (config.mode === "iframe") mountIframe(container, config);
    else mountShadow(container, config);
  }

  var script = currentScript();
  if (script) init(script);
})();
