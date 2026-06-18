import { seed } from "../../src/exports/index.js";

seed({
	id: "simple",
	category: "dev",
	async run(ctx) {
		// @ts-expect-error step() is only available through seed.steps().
		await ctx.step("not-available", async () => null);
	},
});

seed.steps({
	id: "step-seed",
	category: "dev",
	async run({ step }) {
		const result = await step("compute", async ({ db }) => {
			db satisfies unknown;
			return { title: "Hello" };
		});
		result.title satisfies string;
	},
});
