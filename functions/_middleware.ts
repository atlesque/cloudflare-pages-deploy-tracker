export const onRequest: PagesFunction = async ({ request, next }) => {
  const url = new URL(request.url);

  if (url.hostname.endsWith(".pages.dev")) {
    url.hostname = "deploys.atlesque.dev";
    return Response.redirect(url.toString(), 301);
  }

  return next();
};
