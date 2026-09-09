export async function resolve(specifier, context, nextResolve) {
  if (specifier === "@cloudflare/puppeteer") {
    return {
      url: new URL("./mock-cloudflare-puppeteer.js", import.meta.url).href,
      shortCircuit: true
    };
  }
  return nextResolve(specifier, context);
}
