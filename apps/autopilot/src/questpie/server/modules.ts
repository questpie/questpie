import type { AppModuleInput } from "questpie/app";

import { adminModule } from "@questpie/admin/modules/admin";
import { auditModule } from "@questpie/admin/modules/audit";
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

// @ts-expect-error workflowsModule currently exposes a circular generated type.
const autopilotModules = [
	autopilotAdminModule,
	quietAuditModule,
	workflowsModule,
	mcpModule,
] as const satisfies readonly AppModuleInput[];

// @ts-expect-error workflowsModule currently exposes a circular generated type.
export default autopilotModules;
