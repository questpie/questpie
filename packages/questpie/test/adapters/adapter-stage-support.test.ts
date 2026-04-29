import { describe, expect, it } from "bun:test";

import { createAdapterContext } from "../../src/server/adapters/utils/context.js";
import {
	parseFindOneOptions,
	parseFindOptions,
	parseGlobalGetOptions,
	parseGlobalUpdateOptions,
} from "../../src/server/adapters/utils/parsers.js";

describe("adapter workflow stage support", () => {
	it("parses stage from collection/global query options", () => {
		const find = parseFindOptions(
			new URL("http://localhost/posts?stage=review"),
		);
		expect(find.stage).toBe("review");

		const findOne = parseFindOneOptions(
			new URL("http://localhost/posts/post-1?stage=published"),
			"post-1",
		);
		expect(findOne.stage).toBe("published");

		const globalGet = parseGlobalGetOptions(
			new URL("http://localhost/globals/siteSettings?stage=draft"),
		);
		expect(globalGet.stage).toBe("draft");

		const globalUpdate = parseGlobalUpdateOptions(
			new URL("http://localhost/globals/siteSettings?stage=review"),
		);
		expect(globalUpdate.stage).toBe("review");
	});

	it("propagates stage into adapter context", async () => {
		const app = {
			auth: undefined,
			db: {},
			config: {},
			createContext: async (ctx: any) => ctx,
		} as any;

		const context = await createAdapterContext(
			app,
			new Request("http://localhost/posts?stage=review&locale=sk"),
			{},
		);

		expect(context.stage).toBe("review");
		expect(context.appContext.stage).toBe("review");
		expect(context.locale).toBe("sk");
	});
});
