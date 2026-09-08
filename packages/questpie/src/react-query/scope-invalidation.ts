import type { QueryClient } from "@tanstack/react-query";

import type { Projection } from "../internal/client-projection";

/** One conservative family superset, derived from the generated public scope. */
export function createScopeInvalidation(
	client: QueryClient,
	prefix: readonly string[],
	source: Projection,
	ssr: boolean,
) {
	const families = new Map(
		Object.values(source.queries).map((query) => [
			query.identity,
			query.watchable,
		]),
	);
	const pending = new Set<Promise<void>>();
	let retired = false;
	const predicate = ({ queryKey: key }: { queryKey: readonly unknown[] }) => {
		if (
			retired ||
			key[0] !== prefix[0] ||
			key[1] !== prefix[1] ||
			typeof key[2] !== "string" ||
			!families.has(key[2])
		)
			return false;
		return (
			key[3] === "infinite" ||
			(key[3] === "query" && (ssr || families.get(key[2]) === false))
		);
	};
	return {
		committed() {
			if (retired) return;
			const work = (async () => {
				await client.cancelQueries({ predicate });
				if (retired) return;
				await client.invalidateQueries({ predicate, refetchType: "active" });
			})();
			pending.add(work);
			// Query owns refresh failure; it must not replace the Mutation outcome.
			void work.then(
				() => pending.delete(work),
				() => pending.delete(work),
			);
		},
		retire() {
			retired = true;
			return Promise.allSettled(pending).then(() => {});
		},
	};
}
