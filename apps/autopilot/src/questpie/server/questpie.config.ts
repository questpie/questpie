import { runtimeConfig } from "questpie/app";
import { ConsoleAdapter } from "questpie/adapters/console";
import { pgBossAdapter } from "questpie/adapters/pg-boss";

const DATABASE_URL =
	process.env.DATABASE_URL || "postgres://localhost/autopilot";

export default runtimeConfig({
	app: {
		url: process.env.APP_URL || "http://localhost:3000",
	},
	db: {
		url: DATABASE_URL,
	},
	storage: {
		basePath: "/api",
	},
	secret: process.env.BETTER_AUTH_SECRET || "demo-secret-change-in-production",
	email: {
		adapter: new ConsoleAdapter({ logHtml: false }),
	},
	queue: { adapter: pgBossAdapter({ connectionString: DATABASE_URL }) },
});
