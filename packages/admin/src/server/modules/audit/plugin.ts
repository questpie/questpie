import type { CodegenPlugin } from "questpie/codegen";

export default {
	name: "questpie-audit",
	targets: {
		server: {
			discover: {
				audit: { pattern: "config/audit.ts", configKey: "audit" },
			},
			registries: {
				fieldExtensions: {
					audit: {
						stateKey: "audit",
						configType:
							'import("@questpie/admin/modules/audit").AuditFieldPolicy',
					},
				},
				singletonFactories: {
					audit: {
						configType: 'import("@questpie/admin/modules/audit").AuditPolicy',
						imports: [],
					},
				},
			},
		},
	},
} satisfies CodegenPlugin;
