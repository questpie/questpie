import { expect, test } from "bun:test";

import {
	createQueryResourceScope,
	type OneShotQueryMethod,
	type QueryResource,
	type UseQueryResource,
} from "./query-resource";

const scope = createQueryResourceScope();
const messages = scope.watchable({
	identity: "query:messages.page",
	encode: (input: Readonly<{ first: number }>) => JSON.stringify(input),
	call: async () => Object.freeze({ nodes: [] as readonly { id: string }[] }),
	watch: () => () => undefined,
});
const resource = messages.observe({ first: 10 });
const exact: QueryResource<
	Readonly<{ nodes: readonly Readonly<{ id: string }>[] }>
> = resource;
void exact;

declare const oneShot: OneShotQueryMethod<
	Readonly<{ id: string }>,
	Readonly<{ id: string } | null>
>;
const assertOneShotSurface = (): void => {
	// @ts-expect-error one-shot-only Queries do not expose observe
	oneShot.observe({ id: "message:one" });
};
void assertOneShotSurface;

const hook: UseQueryResource = (value) => value.getSnapshot();
const snapshot = hook(resource);
if (snapshot.kind === "ready") {
	const id: string | undefined = snapshot.value.nodes[0]?.id;
	void id;
	// @ts-expect-error generated output remains readonly
	snapshot.value.nodes = [];
}

test("retains exact Query output through the resource and React hook type", () => {
	expect(resource.getSnapshot().kind).toBe("pending");
});
