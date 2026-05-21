import type { AppModuleInput } from "questpie/app";

import { adminModule } from "@questpie/admin/modules/admin";
import { auditModule } from "@questpie/admin/modules/audit";
import { aiModule } from "@questpie/ai/modules/ai";
import { mcpModule } from "@questpie/mcp";
import { workflowsModule } from "@questpie/workflows/modules/workflows";

const hiddenAssets = adminModule.collections.assets.set("admin", {
	...((adminModule.collections.assets.state as any).admin ?? {}),
	hidden: true,
	audit: false,
});

const autopilotAdminModule = {
	...adminModule,
	collections: {
		...adminModule.collections,
		assets: hiddenAssets,
	},
	config: {
		...adminModule.config,
		admin: {
			sidebar: { sections: [], items: [] },
		},
	},
} as unknown as typeof adminModule;

const quietAuditLog = auditModule.collections.admin_audit_log.set("admin", {
	...(auditModule.collections.admin_audit_log.state.admin ?? {}),
	hidden: true,
	audit: false,
});

const quietAuditModule = {
	...auditModule,
	collections: {
		...auditModule.collections,
		admin_audit_log: quietAuditLog,
	},
	config: {
		...auditModule.config,
		admin: {
			sidebar: { items: [] },
		},
	},
} as typeof auditModule;

const quietAiModule: AppModuleInput = {
	...aiModule,
	collections: {
		ai_run_events: aiModule.collections.ai_run_events.set("admin", {
			...(aiModule.collections.ai_run_events.state.admin ?? {}),
			hidden: true,
			audit: false,
		}),
		ai_runs: aiModule.collections.ai_runs.set("admin", {
			...(aiModule.collections.ai_runs.state.admin ?? {}),
			hidden: true,
			audit: false,
		}),
		ai_worker_leases: aiModule.collections.ai_worker_leases.set("admin", {
			...(aiModule.collections.ai_worker_leases.state.admin ?? {}),
			hidden: true,
			audit: false,
		}),
		ai_workers: aiModule.collections.ai_workers.set("admin", {
			...(aiModule.collections.ai_workers.state.admin ?? {}),
			hidden: true,
			audit: false,
		}),
	},
	config: {
		...aiModule.config,
		admin: {
			sidebar: { items: [] },
		},
	},
};

// @ts-expect-error workflowsModule currently exposes a circular generated type.
const autopilotModules = [
	autopilotAdminModule,
	quietAuditModule,
	quietAiModule,
	workflowsModule,
	mcpModule,
] as const satisfies readonly AppModuleInput[];

// @ts-expect-error workflowsModule currently exposes a circular generated type.
export default autopilotModules;
