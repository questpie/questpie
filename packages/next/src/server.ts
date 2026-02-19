import {
  createFetchHandler,
  type AdapterConfig,
  type Questpie,
} from "questpie";

export type NextAdapterConfig = AdapterConfig;

type NextHandler = (request: Request) => Promise<Response>;

const notFoundResponse = () =>
  new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: {
      "Content-Type": "application/json",
    },
  });

/**
 * Create a Next.js-compatible handler for QUESTPIE routes.
 */
export const questpieNext = (
  app: Questpie<any>,
  config: NextAdapterConfig = {},
): NextHandler => {
  const handler = createFetchHandler(app, config);

  return async (request) => {
    const response = await handler(request);
    return response ?? notFoundResponse();
  };
};

/**
 * Convenience helpers for Next.js route handlers.
 */
export const questpieNextRouteHandlers = (
  app: Questpie<any>,
  config: NextAdapterConfig = {},
): Record<string, NextHandler> => {
  const handler = questpieNext(app, config);

  return {
    GET: handler,
    POST: handler,
    PATCH: handler,
    DELETE: handler,
    PUT: handler,
    OPTIONS: handler,
    HEAD: handler,
  };
};
