/**
 * Auth Routes
 *
 * Authentication route handler.
 */

import type { Questpie } from "../../config/questpie.js";
import type { QuestpieConfig } from "../../config/types.js";
import { ApiError } from "../../errors/index.js";
import type { AdapterContext } from "../types.js";
import { handleError } from "../utils/response.js";

/**
 * Standalone auth handler — delegates to app.auth.handler.
 */
export async function authHandler(
	app: Questpie<any>,
	request: Request,
	_params: Record<string, string>,
	_context?: AdapterContext,
): Promise<Response> {
	if (!app.auth) {
		return handleError(ApiError.notImplemented("Authentication"), {
			request,
			app,
		});
	}
	return app.auth.handler(request);
}

/**
 * @deprecated Use standalone `authHandler` instead.
 */
export const createAuthRoute = <
	TConfig extends QuestpieConfig = QuestpieConfig,
>(
	app: Questpie<TConfig>,
) => {
	return async (request: Request): Promise<Response> => {
		return authHandler(app, request, {});
	};
};
