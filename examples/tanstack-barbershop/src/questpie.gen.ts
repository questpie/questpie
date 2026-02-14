export {};

declare module "questpie" {
	interface Register {
		app: typeof import("./questpie/server/cms").baseCms.$inferCms;
	}
}
