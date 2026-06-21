import puppeteer from '@cloudflare/puppeteer';
import { VIEWPORTS, CONFIG } from './config.js';
import { sleep } from './utils.js';
import { trackBrowserUsage } from './db.js';
import { getRadarInsights } from './radar.js';

async function capturePageWithMetrics(env22, url, options = {}) {
  const { device = "desktop", fullPage = false, attempt = 1 } = options;
  try {
    const browser = await puppeteer.launch(env22.BROWSER);
    const page = await browser.newPage();
    const viewport = VIEWPORTS[device] || VIEWPORTS.desktop;
    await page.setViewport(viewport);
    const userAgents = {
      desktop: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      tablet: "Mozilla/5.0 (iPad; CPU OS 14_0 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15",
      mobile: "Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 Safari/605.1.15"
    };
    await page.setUserAgent(userAgents[device] || userAgents.desktop);
    const startTime = Date.now();
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: CONFIG.SCREENSHOT_TIMEOUT_MS });
      await sleep(fullPage ? 2e3 : 1500);
      const loadTime = Date.now() - startTime;
      const seoData = await page.evaluate(() => {
        const title22 = document.title || "";
        const metaDesc = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
        const h1Elements = document.querySelectorAll("h1");
        const h2Count = document.querySelectorAll("h2").length;
        const imgsWithoutAlt = document.querySelectorAll("img:not([alt]), img[alt='']").length;
        const a11y = {
          score: 100,
          issues: [],
          checks: []
        };
        const hasLang = !!document.documentElement.getAttribute("lang");
        a11y.checks.push({ name: "Language attribute", pass: hasLang, detail: hasLang ? "html[lang] is set" : "Missing lang on <html>" });
        if (!hasLang) {
          a11y.score -= 10;
          a11y.issues.push("Missing lang attribute on <html>");
        }
        a11y.checks.push({ name: "Image alt text", pass: imgsWithoutAlt === 0, detail: imgsWithoutAlt === 0 ? "All images have alt text" : `${imgsWithoutAlt} images missing alt` });
        if (imgsWithoutAlt > 0) {
          a11y.score -= Math.min(imgsWithoutAlt * 3, 15);
        }
        const inputs = document.querySelectorAll('input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select');
        let unlabeled = 0;
        inputs.forEach((input) => {
          const id = input.getAttribute("id");
          const hasLabel = id ? !!document.querySelector(`label[for="${id}"]`) : false;
          const hasAriaLabel = !!input.getAttribute("aria-label") || !!input.getAttribute("aria-labelledby");
          const hasPlaceholder = !!input.getAttribute("placeholder");
          if (!hasLabel && !hasAriaLabel && !hasPlaceholder) unlabeled++;
        });
        a11y.checks.push({ name: "Form labels", pass: unlabeled === 0, detail: unlabeled === 0 ? "All inputs labeled" : `${unlabeled} inputs without labels` });
        if (unlabeled > 0) {
          a11y.score -= Math.min(unlabeled * 5, 15);
        }
        const hasSkipNav = !!document.querySelector('a[href="#main"], a[href="#content"], [class*="skip"]');
        a11y.checks.push({ name: "Skip navigation", pass: hasSkipNav, detail: hasSkipNav ? "Skip link found" : "No skip navigation link" });
        if (!hasSkipNav) {
          a11y.score -= 5;
        }
        const headings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6"));
        let hasSkippedLevel = false;
        let prevLevel = 0;
        headings.forEach((h) => {
          const level2 = parseInt(h.tagName[1]);
          if (prevLevel > 0 && level2 > prevLevel + 1) hasSkippedLevel = true;
          prevLevel = level2;
        });
        a11y.checks.push({ name: "Heading hierarchy", pass: !hasSkippedLevel, detail: hasSkippedLevel ? "Heading levels are skipped" : "Headings follow order" });
        if (hasSkippedLevel) {
          a11y.score -= 10;
        }
        const badLinks = Array.from(document.querySelectorAll("a")).filter((a) => {
          const text = (a.textContent || "").trim().toLowerCase();
          return text === "click here" || text === "here" || text === "read more" || text === "link";
        });
        a11y.checks.push({ name: "Descriptive links", pass: badLinks.length === 0, detail: badLinks.length === 0 ? "All links descriptive" : `${badLinks.length} vague link texts` });
        if (badLinks.length > 0) {
          a11y.score -= Math.min(badLinks.length * 3, 10);
        }
        const hasViewport = !!document.querySelector('meta[name="viewport"]');
        a11y.checks.push({ name: "Viewport meta", pass: hasViewport, detail: hasViewport ? "Responsive viewport set" : "Missing viewport meta" });
        if (!hasViewport) {
          a11y.score -= 15;
        }
        const emptyButtons = Array.from(document.querySelectorAll("button")).filter((b) => {
          return !(b.textContent || "").trim() && !b.getAttribute("aria-label");
        });
        a11y.checks.push({ name: "Button labels", pass: emptyButtons.length === 0, detail: emptyButtons.length === 0 ? "All buttons labeled" : `${emptyButtons.length} buttons without text` });
        if (emptyButtons.length > 0) {
          a11y.score -= Math.min(emptyButtons.length * 5, 15);
        }
        a11y.score = Math.max(0, a11y.score);
        return {
          title: title22,
          metaDescription: metaDesc,
          h1Text: h1Elements[0]?.textContent?.trim() || "",
          h1Count: h1Elements.length,
          h2Count,
          imgWithoutAlt: imgsWithoutAlt,
          accessibility: a11y
        };
      });
      let perfData = {
        domContentLoaded: 0,
        domInteractive: 0,
        loadEventEnd: 0,
        resourceCount: 0,
        resourceBreakdown: {
          scripts: { count: 0, size: 0 },
          stylesheets: { count: 0, size: 0 },
          images: { count: 0, size: 0 },
          fonts: { count: 0, size: 0 },
          other: { count: 0, size: 0 }
        },
        totalTransferSize: 0,
        fcp: null,
        ttfb: 0
      };
      try {
        perfData = await page.evaluate(() => {
          const perf = window.performance.getEntriesByType("navigation")[0];
          const resources = window.performance.getEntriesByType("resource") || [];
          const paint = window.performance.getEntriesByType("paint") || [];
          const resourceBreakdown = {
            scripts: { count: 0, size: 0 },
            stylesheets: { count: 0, size: 0 },
            images: { count: 0, size: 0 },
            fonts: { count: 0, size: 0 },
            other: { count: 0, size: 0 }
          };
          resources.forEach((r) => {
            const size = r.transferSize || 0;
            if (r.initiatorType === "script" || r.name && r.name.match(/\.js(\?|$)/i)) {
              resourceBreakdown.scripts.count++;
              resourceBreakdown.scripts.size += size;
            } else if (r.initiatorType === "css" || r.name && r.name.match(/\.css(\?|$)/i)) {
              resourceBreakdown.stylesheets.count++;
              resourceBreakdown.stylesheets.size += size;
            } else if (r.initiatorType === "img" || r.name && r.name.match(/\.(png|jpg|jpeg|gif|webp|svg|ico)(\?|$)/i)) {
              resourceBreakdown.images.count++;
              resourceBreakdown.images.size += size;
            } else if (r.name && r.name.match(/\.(woff2?|ttf|otf|eot)(\?|$)/i)) {
              resourceBreakdown.fonts.count++;
              resourceBreakdown.fonts.size += size;
            } else {
              resourceBreakdown.other.count++;
              resourceBreakdown.other.size += size;
            }
          });
          const fcpEntry = paint.find((p) => p.name === "first-contentful-paint");
          const fcp = fcpEntry ? fcpEntry.startTime : null;
          const totalTransferSize = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
          return {
            domContentLoaded: perf?.domContentLoadedEventEnd || 0,
            domInteractive: perf?.domInteractive || 0,
            loadEventEnd: perf?.loadEventEnd || 0,
            resourceCount: resources.length,
            resourceBreakdown,
            totalTransferSize,
            fcp,
            ttfb: perf?.responseStart || 0
          };
        });
      } catch (e) {
        console.log("Failed to get performance data, using defaults:", e);
      }
      let pageDimensions = { viewportHeight: 720, pageHeight: 720, viewportWidth: 1280, pageWidth: 1280 };
      try {
        pageDimensions = await page.evaluate(() => {
          return {
            viewportHeight: window.innerHeight || 720,
            pageHeight: document.documentElement.scrollHeight || 720,
            viewportWidth: window.innerWidth || 1280,
            pageWidth: document.documentElement.scrollWidth || 1280
          };
        });
      } catch (e) {
        console.log("Failed to get page dimensions, using defaults");
      }
      let screenshot;
      try {
        screenshot = await page.screenshot({
          type: "jpeg",
          quality: CONFIG.SCREENSHOT_QUALITY,
          fullPage
        });
      } catch (e) {
        console.log("Full page screenshot failed, falling back to viewport");
        screenshot = await page.screenshot({
          type: "jpeg",
          quality: CONFIG.SCREENSHOT_QUALITY,
          fullPage: false
        });
      }
      const foldLinePercent = fullPage && pageDimensions.pageHeight > pageDimensions.viewportHeight ? Math.min(100, pageDimensions.viewportHeight / pageDimensions.pageHeight * 100) : 70;
      const seoIssues = [];
      let seoScore = 100;
      let titleStatus = "good";
      if (!seoData.title) {
        seoIssues.push("Missing page title");
        seoScore -= 20;
        titleStatus = "missing";
      } else if (seoData.title.length < 30) {
        seoIssues.push("Title too short (< 30 chars)");
        seoScore -= 10;
        titleStatus = "short";
      } else if (seoData.title.length > 60) {
        seoIssues.push("Title too long (> 60 chars)");
        seoScore -= 5;
        titleStatus = "long";
      }
      let metaStatus = "good";
      if (!seoData.metaDescription) {
        seoIssues.push("Missing meta description");
        seoScore -= 15;
        metaStatus = "missing";
      } else if (seoData.metaDescription.length < 120) {
        seoIssues.push("Meta description too short (< 120 chars)");
        seoScore -= 5;
        metaStatus = "short";
      } else if (seoData.metaDescription.length > 160) {
        seoIssues.push("Meta description too long (> 160 chars)");
        seoScore -= 5;
        metaStatus = "long";
      }
      let h1Status = "good";
      if (seoData.h1Count === 0) {
        seoIssues.push("Missing H1 heading");
        seoScore -= 15;
        h1Status = "missing";
      } else if (seoData.h1Count > 1) {
        seoIssues.push(`Multiple H1 headings (${seoData.h1Count})`);
        seoScore -= 10;
        h1Status = "multiple";
      }
      if (seoData.imgWithoutAlt > 0) {
        seoIssues.push(`${seoData.imgWithoutAlt} images without alt text`);
        seoScore -= Math.min(seoData.imgWithoutAlt * 2, 15);
      }
      const perfIssues = [];
      const perfRecommendations = [];
      let perfScore = 100;
      if (loadTime > 5e3) {
        perfIssues.push("Very slow load time (> 5s)");
        perfScore -= 30;
        perfRecommendations.push("Optimize server response time and reduce render-blocking resources");
      } else if (loadTime > 3e3) {
        perfIssues.push("Slow load time (> 3s)");
        perfScore -= 15;
        perfRecommendations.push("Consider lazy loading images and deferring non-critical JavaScript");
      } else if (loadTime > 2e3) {
        perfIssues.push("Could be faster (> 2s)");
        perfScore -= 5;
      }
      if (perfData.fcp) {
        if (perfData.fcp > 3e3) {
          perfIssues.push("Slow First Contentful Paint (> 3s)");
          perfScore -= 15;
          perfRecommendations.push("Reduce server response time and eliminate render-blocking resources");
        } else if (perfData.fcp > 1800) {
          perfIssues.push("FCP needs improvement (> 1.8s)");
          perfScore -= 5;
        }
      }
      if (perfData.ttfb > 800) {
        perfIssues.push("Slow server response (TTFB > 800ms)");
        perfScore -= 10;
        perfRecommendations.push("Optimize server-side processing or use a CDN");
      } else if (perfData.ttfb > 400) {
        perfIssues.push("Server response could be faster (TTFB > 400ms)");
        perfScore -= 5;
      }
      if (perfData.resourceCount > 100) {
        perfIssues.push(`Too many requests (${perfData.resourceCount})`);
        perfScore -= 15;
        perfRecommendations.push("Bundle and minify CSS/JS files, use image sprites");
      } else if (perfData.resourceCount > 50) {
        perfIssues.push(`High request count (${perfData.resourceCount})`);
        perfScore -= 5;
      }
      const totalSizeKB = Math.round(perfData.totalTransferSize / 1024);
      if (totalSizeKB > 3e3) {
        perfIssues.push(`Large page size (${(totalSizeKB / 1024).toFixed(1)}MB)`);
        perfScore -= 15;
        perfRecommendations.push("Compress images, minify code, and remove unused CSS/JS");
      } else if (totalSizeKB > 1500) {
        perfIssues.push(`Page size could be smaller (${totalSizeKB}KB)`);
        perfScore -= 5;
      }
      const jsSizeKB = Math.round(perfData.resourceBreakdown.scripts.size / 1024);
      if (jsSizeKB > 500) {
        perfIssues.push(`Heavy JavaScript (${jsSizeKB}KB)`);
        perfScore -= 10;
        perfRecommendations.push("Code split JavaScript and lazy load non-critical scripts");
      }
      const imgSizeKB = Math.round(perfData.resourceBreakdown.images.size / 1024);
      if (imgSizeKB > 1e3) {
        perfIssues.push(`Large image payload (${imgSizeKB}KB)`);
        perfScore -= 10;
        perfRecommendations.push("Use WebP/AVIF formats and implement responsive images");
      }
      const radarApiToken = await env22.CONFIG.get("RADAR_API_TOKEN") || env22.RADAR_API_TOKEN;
      const radarInsights = await getRadarInsights(url, radarApiToken || void 0);
      const seo = {
        score: Math.max(0, seoScore),
        title: { text: seoData.title, length: seoData.title.length, status: titleStatus },
        metaDescription: { text: seoData.metaDescription, length: seoData.metaDescription.length, status: metaStatus },
        h1: { text: seoData.h1Text, count: seoData.h1Count, status: h1Status },
        h2Count: seoData.h2Count,
        imgWithoutAlt: seoData.imgWithoutAlt,
        issues: seoIssues,
        accessibility: seoData.accessibility,
        radar: {
          ranking: radarInsights.ranking,
          geoDistribution: radarInsights.geoDistribution,
          domain: new URL(url).hostname.replace(/^www\./, "")
        }
      };
      const performance22 = {
        score: Math.max(0, perfScore),
        loadTime,
        domContentLoaded: perfData.domContentLoaded,
        domInteractive: perfData.domInteractive,
        resourceCount: perfData.resourceCount,
        pageSize: screenshot.length,
        totalTransferSize: perfData.totalTransferSize,
        resourceBreakdown: perfData.resourceBreakdown,
        fcp: perfData.fcp,
        ttfb: perfData.ttfb,
        issues: perfIssues,
        recommendations: perfRecommendations
      };
      return {
        screenshot,
        seo,
        performance: performance22,
        pageDimensions,
        foldLinePercent,
        isFullPage: fullPage
      };
    } finally {
      await browser.close();
    }
  } catch (error32) {
    const errorMsg = error32.message || String(error32);
    console.error(`Capture attempt ${attempt} failed:`, errorMsg, error32.stack);
    if (errorMsg.includes("429") || errorMsg.includes("Rate limit") || errorMsg.includes("rate limit") || errorMsg.includes("Browser") || errorMsg.includes("browser") || errorMsg.includes("limit")) {
      if (attempt < CONFIG.MAX_BROWSER_RETRIES) {
        const waitTime = CONFIG.BROWSER_RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`Browser busy, retrying in ${waitTime}ms (attempt ${attempt + 1}/${CONFIG.MAX_BROWSER_RETRIES})`);
        await sleep(waitTime);
        await trackBrowserUsage(env22, 1);
        return capturePageWithMetrics(env22, url, { device, fullPage, attempt: attempt + 1 });
      }
      throw new Error("Browser service is busy. Please try again in a minute.");
    }
    if (attempt < CONFIG.MAX_RETRIES) {
      console.log(`Retrying capture (attempt ${attempt + 1}/${CONFIG.MAX_RETRIES})...`);
      await sleep(CONFIG.RETRY_DELAY_MS * attempt * 2);
      await trackBrowserUsage(env22, 1);
      return capturePageWithMetrics(env22, url, { device, fullPage, attempt: attempt + 1 });
    }
    let userMessage = "Please try again in a moment";
    if (errorMsg.includes("timeout") || errorMsg.includes("Timeout")) {
      userMessage = "Page took too long to load";
    } else if (errorMsg.includes("net::ERR") || errorMsg.includes("Navigation")) {
      userMessage = "Could not load the page. Check the URL.";
    } else if (errorMsg.includes("Protocol")) {
      userMessage = "Browser communication error. Please try again.";
    }
    throw new Error(`Failed to capture page: ${userMessage} (${errorMsg.substring(0, 100)})`);
  }
}


export { capturePageWithMetrics };
