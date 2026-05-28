import { seed } from "questpie/services";

export default seed({
	id: "autopilotRuntimeDefaults",
	description:
		"Default AI runtime config so runs resolve a runtime without manual setup: Anthropic provider + enabled Claude Code model",
	category: "dev",
	async run({ collections, createContext, log }) {
		const ctx = await createContext({ accessMode: "system", locale: "en" });

		const existing = await collections.models.find(
			{ where: { enabled: true }, limit: 1 },
			ctx,
		);
		if (existing.totalDocs > 0) {
			log("Enabled AI model already exists, skipping runtime defaults seed");
			return;
		}

		log("Creating default Anthropic provider...");
		const provider = await collections.providers.create(
			{
				name: "Anthropic",
				type: "anthropic",
				secretRef: "ANTHROPIC_API_KEY",
				enabled: true,
			},
			ctx,
		);

		log("Creating default Claude Code model...");
		await collections.models.create(
			{
				name: "Claude (Claude Code)",
				provider: provider.id,
				modelId: "claude-sonnet-4-5",
				runtime: "claude-code",
				enabled: true,
			},
			ctx,
		);

		log("Runtime defaults seeded");
	},
});
