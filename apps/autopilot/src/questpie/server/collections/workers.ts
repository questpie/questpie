import { index, uniqueIndex } from "drizzle-orm/pg-core";

import { collection } from "#questpie/factories";

export const workers = collection("workers")
	.fields(({ f }) => ({
		deviceId: f.text().required().label({ en: "Device ID" }),
		name: f.text().required().label({ en: "Name" }),
		status: f
			.select([
				{ value: "online", label: { en: "Online" } },
				{ value: "offline", label: { en: "Offline" } },
				{ value: "busy", label: { en: "Busy" } },
				{ value: "draining", label: { en: "Draining" } },
			])
			.default("offline")
			.label({ en: "Status" }),
		capabilities: f.json().label({ en: "Capabilities" }),
		lastHeartbeat: f.datetime().label({ en: "Last Heartbeat" }),
		machineSecretHash: f
			.text()
			.outputFalse()
			.label({ en: "Machine Secret Hash" }),
		metadata: f.json().label({ en: "Metadata" }),
	}))
	.title(({ f }) => f.name)
	.admin(({ c }) => ({
		label: { en: "Connected Devices" },
		icon: c.icon("ph:desktop-tower"),
		hidden: true,
	}))
	.list(({ v }) => v.collectionTable({}))
	.form(({ v, f }) =>
		v.collectionForm({
			sidebar: {
				position: "right",
				fields: [f.status],
			},
			fields: [f.name, f.deviceId, f.capabilities, f.lastHeartbeat],
		}),
	)
	.indexes(({ table }) => [
		uniqueIndex("workers_device_id_unique").on(table.deviceId as any),
		index("workers_status_idx").on(table.status as any),
	]);
