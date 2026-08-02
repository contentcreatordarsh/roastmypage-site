export async function handleRouteModules(handlers, request, env, ctx, routeContext) {
  for (const handler of handlers) {
    const response = await handler(request, env, ctx, routeContext);
    if (response) {
      return response;
    }
  }
  return null;
}
