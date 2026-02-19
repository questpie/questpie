/**
 * Shared server-side helpers for data fetching
 */

import { app } from "@/questpie/server/app";

/**
 * Create app context for server-side data fetching
 */
export async function createServerContext() {
	return app.createContext({
		accessMode: "system",
	});
}

export { app };
