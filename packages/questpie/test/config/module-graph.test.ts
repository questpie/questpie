import { describe, expect, it } from "bun:test";

import { createApp } from "../../src/server/config/create-app.js";
import type {
	AppModuleInput,
	RuntimeConfig,
} from "../../src/server/config/module-types.js";
import coreModule from "../../src/server/modules/core/.generated/module.js";

type MutableModule = {
	name: string;
	modules?: MutableModule[];
};

describe("runtime module graph", () => {
	it("rejects a dependency cycle with its actionable path", async () => {
		const alpha: MutableModule = { name: "alpha" };
		const beta: MutableModule = { name: "beta", modules: [alpha] };
		alpha.modules = [beta];

		await expect(
			createApp({ modules: [alpha as AppModuleInput] }, {} as RuntimeConfig),
		).rejects.toThrow(/Circular module dependency: alpha -> beta -> alpha/);
	});

	it("reports both graph paths for different modules sharing one name", async () => {
		const first = { name: "shared" } as AppModuleInput;
		const second = { name: "shared" } as AppModuleInput;
		const left = { name: "left", modules: [first] } as AppModuleInput;
		const right = { name: "right", modules: [second] } as AppModuleInput;

		await expect(
			createApp({ modules: [left, right] }, {} as RuntimeConfig),
		).rejects.toThrow(/left -> shared.*right -> shared/s);
	});

	it("does not let a counterfeit core module replace the canonical core", async () => {
		const counterfeit = { name: coreModule.name } as AppModuleInput;

		await expect(
			createApp({ modules: [counterfeit] }, {} as RuntimeConfig),
		).rejects.toThrow(/different modules.*questpie-core/i);
	});
});
