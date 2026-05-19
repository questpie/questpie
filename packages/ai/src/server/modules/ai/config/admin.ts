const aiAdminConfig = {
	sidebar: {
		items: [
			{
				type: "group" as const,
				label: { en: "AI" },
				icon: { type: "icon" as const, props: { name: "ph:brain" } },
				items: [
					{ type: "collection" as const, collection: "ai_runs" },
					{ type: "collection" as const, collection: "ai_workers" },
					{ type: "collection" as const, collection: "ai_worker_leases" },
					{ type: "collection" as const, collection: "ai_run_events" },
				],
			},
		],
	},
};

export default aiAdminConfig;
