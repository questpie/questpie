import { adminModule, adminRpc } from "@questpie/admin/server";
import { ConsoleAdapter, q } from "questpie";
import { env } from "@/lib/env.js";
import { migrations } from "../../migrations/index.js";
import { posts } from "./collections/index.js";
import { configureDashboard } from "./dashboard.js";
import { siteSettings } from "./globals/index.js";
import { r } from "./rpc.js";
import { configureSidebar } from "./sidebar.js";

// ─── App Instance ───────────────────────────────────────────────────────────
// The built application. Standalone — does NOT depend on appRpc.

export const app = q({ name: "{{projectName}}" })
	.use(adminModule)
	.collections({ posts })
	.globals({ siteSettings })
	.sidebar(configureSidebar)
	.branding({ name: "{{projectName}}" })
	.dashboard(configureDashboard)
	.auth({
		emailAndPassword: {
			enabled: true,
			requireEmailVerification: false,
		},
		baseURL: env.APP_URL,
		basePath: "/api/auth",
		secret: env.BETTER_AUTH_SECRET,
	})
	.build({
		app: { url: env.APP_URL },
		db: { url: env.DATABASE_URL },
		storage: { basePath: "/api" },
		migrations,
		email: {
			adapter: new ConsoleAdapter({ logHtml: false }),
		},
	});

// ─── RPC Router ─────────────────────────────────────────────────────────────
// Standalone router. Both app and appRpc are passed to createFetchHandler()
// in routes/api/$.ts. Add your custom RPC functions here.

export const appRpc = r.router({
	...adminRpc,
});

// ─── Type Exports ───────────────────────────────────────────────────────────
// Used by: rpc.ts (App for typed handlers), client (App + AppRpc)

export type App = typeof app;
export type AppRpc = typeof appRpc;
