import { app } from "#questpie";
import { questpieNextRouteHandlers } from "@questpie/next";

export const { GET, POST, PUT, PATCH, DELETE, OPTIONS, HEAD } =
	questpieNextRouteHandlers(app, {
		basePath: "/api",
	});
