import { mcpConfig } from "@questpie/mcp";

export default mcpConfig({
	name: "questpie-autopilot",
	version: "0.1.0",
	crud: {
		maxLimit: 100,
		collections: {
			projects: { read: true },
			tasks: { read: true, write: true },
			task_relations: { read: true, write: true },
			run_links: { read: true },
			assets: { read: true, write: true, delete: true },
			chat_sessions: { read: true },
			chat_messages: { read: true },
			schedules: { read: true, write: true },
			providers: { read: true },
			models: { read: true },
			environments: { read: true },
			scripts: { read: true },
		},
	},
	routes: {
		exposeAnnotated: true,
	},
	resources: {
		schemas: true,
		routes: true,
	},
	http: {
		enableJsonResponse: true,
	},
	stdio: {
		accessMode: "system",
	},
});
