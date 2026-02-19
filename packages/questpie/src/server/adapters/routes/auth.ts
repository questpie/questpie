/**
 * Auth Routes
 *
 * Authentication route handler.
 */

import type { Questpie } from "../../config/questpie.js";
import type { QuestpieConfig } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
import { handleError } from "../utils/response.js";

export const createAuthRoute = <
  TConfig extends QuestpieConfig = QuestpieConfig,
>(app: Questpie<TConfig>,
) => {
  return async (request: Request): Promise<Response> => {
    if (!app.auth) {
      return handleError(ApiError.notImplemented("Authentication"), {
        request,
        app,
      });
    }
    return app.auth.handler(request);
  };
};
