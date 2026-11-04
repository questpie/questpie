import { test, expect } from "bun:test";

import { QueryClient } from "@tanstack/react-query";

import { createQuestpieQueryOptions } from "./index.js";
function fixture() {
	const plain: any[] = [],
		topics: any[] = [];
	const c: any = {
		collections: {
			actors: {
				find: async (o: any) => {
					plain.push(o);
					return { docs: [] };
				},
				count: async (o: any) => {
					plain.push(o);
					return 0;
				},
			},
		},
		globals: {
			settings: {
				get: async (o: any) => {
					plain.push(o);
					return {};
				},
			},
		},
		realtime: {
			async *streamEvents(t: any) {
				topics.push(t);
				yield {
					type: "snapshot",
					data:
						t.operation === "count"
							? 0
							: t.resourceType === "global"
								? {}
								: { docs: [] },
				};
			},
		},
	};
	return { c, plain, topics };
}
const modes = ["find", "count", "global"] as const;
for (const mode of modes) {
	const options =
		mode === "global"
			? {}
			: { where: { company: "company-fixture", user: "user-fixture" } };
	const build = (q: any, o: any, live: boolean) =>
		mode === "global"
			? q.globals.settings.get(o, { realtime: live })
			: q.collections.actors[mode](o, { realtime: live });
	test(
		mode + ": factory locale is identical in PLAIN read and LIVE topic",
		async () => {
			const f = fixture(),
				q = createQuestpieQueryOptions(f.c, { locale: "sk" });
			const plain = build(q, options, false),
				live = build(q, options, true);
			expect(plain.queryKey).toEqual(live.queryKey);
			await new QueryClient().fetchQuery(plain);
			await new QueryClient().fetchQuery(live);
			expect(f.plain[0].locale).toBe("sk");
			expect(f.topics[0].locale).toBe("sk");
			expect(options).not.toHaveProperty("locale");
		},
	);
	test(mode + ": explicit locale retains precedence", async () => {
		const f = fixture(),
			q = createQuestpieQueryOptions(f.c, { locale: "sk" }),
			o = { ...options, locale: "en" };
		await new QueryClient().fetchQuery(build(q, o, false));
		await new QueryClient().fetchQuery(build(q, o, true));
		expect(f.plain[0].locale).toBe("en");
		expect(f.topics[0].locale).toBe("en");
	});
	test(
		mode + ": unconfigured factory preserves original options reference",
		async () => {
			const f = fixture(),
				q = createQuestpieQueryOptions(f.c);
			await new QueryClient().fetchQuery(build(q, options, false));
			await new QueryClient().fetchQuery(build(q, options, true));
			expect(f.plain[0]).toBe(options);
			expect(f.topics[0]).not.toHaveProperty("locale");
		},
	);
}
test("locale change cannot attach distinct Query keys to one collection topic", async () => {
	const f = fixture();
	const o = {
		where: { company: "company-fixture", user: "user-fixture" },
		limit: 1,
	};
	const en = createQuestpieQueryOptions(f.c, {
			locale: "en",
		}).collections.actors.find(o, { realtime: true }),
		sk = createQuestpieQueryOptions(f.c, {
			locale: "sk",
		}).collections.actors.find(o, { realtime: true });
	expect(en.queryKey).not.toEqual(sk.queryKey);
	await new QueryClient().fetchQuery(en);
	await new QueryClient().fetchQuery(sk);
	expect(f.topics[0]).not.toEqual(f.topics[1]);
	expect(f.topics[0].where).toEqual(f.topics[1].where);
});
