/**
 * Sequential dispatcher: each route module returns a Response or null.
 * First non-null response wins, matching the previous if/return chain in index.js.
 */
export async function dispatch(handlers, request, env, ctx, url, corsHeaders) {
  for (const handle of handlers) {
    const response = await handle(request, env, ctx, url, corsHeaders);
    if (response) return response;
  }
  return null;
}
