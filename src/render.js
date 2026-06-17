import puppeteer from '@cloudflare/puppeteer';
import { safeLogError } from './utils.js';

async function renderSvgToPng(env22, svgContent, cacheKey, width = 1200, height = 630) {
  const r2Key = `og-png/${cacheKey}.png`;
  const cached = await env22.SCREENSHOTS.get(r2Key);
  if (cached) {
    return { png: await cached.arrayBuffer(), cached: true };
  }
  const htmlPage = `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>*{margin:0;padding:0;}body{width:${width}px;height:${height}px;overflow:hidden;}</style></head><body>${svgContent}</body></html>`;
  const browser = await puppeteer.launch(env22.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport({ width, height, deviceScaleFactor: 1 });
    await page.setContent(htmlPage, { waitUntil: "networkidle0", timeout: 1e4 });
    const pngBuffer = await page.screenshot({ type: "png", clip: { x: 0, y: 0, width, height } });
    await page.close();
    const png = pngBuffer instanceof Buffer ? pngBuffer.buffer.slice(pngBuffer.byteOffset, pngBuffer.byteOffset + pngBuffer.byteLength) : pngBuffer;
    await env22.SCREENSHOTS.put(r2Key, png, {
      httpMetadata: { contentType: "image/png", cacheControl: "public, max-age=2592000" }
    });
    return { png, cached: false };
  } finally {
    await browser.close();
  }
}


export { renderSvgToPng };
