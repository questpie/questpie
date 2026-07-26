import { describe, expect, test } from "bun:test";

import { dehydrate, hydrate, QueryClient } from "@tanstack/react-query";
import { fromCrossJSON, toCrossJSON } from "seroval";

describe("temporal query hydration", () => {
	test("QUESTPIE query data keeps Date identity through TanStack Start serialization", () => {
		const instant = new Date("2025-03-30T00:30:00.123Z");
		const server = new QueryClient();
		server.setQueryData(["events"], {
			docs: [
				{
					id: "event-1",
					startsAt: instant,
					dateOnly: "2025-03-30",
					isoLookingString: instant.toISOString(),
				},
			],
		});

		const dehydrated = dehydrate(server);
		const dehydratedData = dehydrated.queries[0]?.state.data as any;
		expect(dehydratedData.docs[0].startsAt).toBeInstanceOf(Date);

		const serialized = JSON.stringify(toCrossJSON(dehydrated));
		const transported = fromCrossJSON<typeof dehydrated>(
			JSON.parse(serialized),
			{},
		);
		const browser = new QueryClient();
		hydrate(browser, transported);
		const hydrated = browser.getQueryData<any>(["events"]);
		expect(hydrated.docs[0].startsAt).toBeInstanceOf(Date);
		expect(hydrated.docs[0].startsAt.getTime()).toBe(instant.getTime());
		expect(hydrated.docs[0].dateOnly).toBe("2025-03-30");
		expect(hydrated.docs[0].isoLookingString).not.toBeInstanceOf(Date);
	});
});
