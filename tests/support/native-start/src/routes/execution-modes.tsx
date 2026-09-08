import {
	useInfiniteQuery,
	useQuery,
	useSuspenseInfiniteQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { firstId } from "../data/questpie";
import { report } from "../tracer/scenario";

const pageInput = { first: 1, statuses: null, teamIds: null };
export const Route = createFileRoute("/execution-modes")({
	loader: async ({ context: { owner } }) => {
		await Promise.all([
			owner.cache.ensureQueryData(
				owner.ordinaryApi.queries["tasks.summary"].options({ id: firstId }),
			),
			owner.cache.ensureInfiniteQueryData(
				owner.api.queries["tickets.queue"].infiniteOptions(pageInput),
			),
			owner.cache.ensureQueryData(
				owner.api.queries["tickets.detail"].options({ id: firstId }),
			),
		]);
	},
	component: ExecutionModes,
});

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function ExecutionModes() {
	const { owner } = Route.useRouteContext();
	const [captured] = useState(() => ({
		adapter: owner.api,
		ordinaryAdapter: owner.ordinaryApi,
		ordinary: owner.ordinaryApi.queries["tasks.summary"].options({
			id: firstId,
		}),
		infinite: owner.api.queries["tickets.queue"].infiniteOptions(pageInput),
		live: owner.api.queries["tickets.detail"].options({ id: firstId }),
	}));
	const ordinary = useQuery({ ...captured.ordinary, enabled: false });
	const infinite = useInfiniteQuery({
		...captured.infinite,
		enabled: false,
		maxPages: 2,
	});
	const live = useQuery({ ...captured.live, enabled: false });
	const [retired, setRetired] = useState(false);
	const started = useRef(false);
	const nextPage = useRef<HTMLButtonElement>(null);
	const refetchPages = useRef<HTMLButtonElement>(null);
	const pageOperation = useRef<Promise<unknown>>(Promise.resolve());
	useEffect(() => {
		if (started.current) return;
		started.current = true;
		void (async () => {
			const scenario = new URL(window.location.href).searchParams.get(
				"scenario",
			);
			const keys = [
				captured.ordinary.queryKey,
				captured.infinite.queryKey,
				captured.live.queryKey,
			];
			// Explicit native invalidation defeats the intentionally future-dated SSR
			// freshness. fetchQuery also executes disabled observers on explicit demand.
			await Promise.all(
				keys.map((queryKey) =>
					owner.cache.invalidateQueries({
						queryKey,
						exact: true,
						refetchType: "none",
					}),
				),
			);
			const pending = [
				owner.cache.fetchQuery(captured.ordinary),
				owner.cache.fetchInfiniteQuery({ ...captured.infinite, maxPages: 2 }),
				owner.cache.fetchQuery(captured.live),
			].map((operation) => operation.catch(() => undefined));
			await tick();
			const held = {
				ordinaryDate:
					owner.cache.getQueryData(captured.ordinary.queryKey)
						?.updatedAt instanceof Date,
				infiniteDate:
					owner.cache.getQueryData(captured.infinite.queryKey)?.pages[0]
						?.nodes[0]?.updatedAt instanceof Date,
				ordinaryPending:
					owner.cache.getQueryState(keys[0]!)?.fetchStatus === "fetching",
				infinitePending:
					owner.cache.getQueryState(keys[1]!)?.fetchStatus === "fetching",
				livePending:
					owner.cache.getQueryState(keys[2]!)?.fetchStatus === "fetching",
			};
			let cancelled = false;
			if (scenario === "cancel") {
				await Promise.all(
					keys.map((queryKey) =>
						owner.cache.cancelQueries({ queryKey, exact: true }),
					),
				);
				cancelled = keys.every(
					(queryKey) =>
						owner.cache.getQueryState(queryKey)?.fetchStatus === "idle",
				);
			} else if (scenario === "retire") {
				setRetired(true);
				await tick();
				await Promise.all([
					captured.adapter.dispose(),
					captured.ordinaryAdapter.dispose(),
				]);
				cancelled = keys.every(
					(queryKey) => owner.cache.getQueryData(queryKey) === undefined,
				);
			}
			await report("modes-held", { ...held, ...owner.metrics() });
			while (!owner.metrics().ready) await tick();
			await Promise.all(pending);
			await tick();
			if (scenario === "resume") {
				// Drive real React handlers; native Query owns continuation and maxPages.
				nextPage.current!.click();
				await pageOperation.current;
				await tick();
				nextPage.current!.click();
				await pageOperation.current;
				await tick();
				nextPage.current!.click();
				await pageOperation.current;
				await tick();
				refetchPages.current!.click();
				await pageOperation.current;
				await tick();
				const page = owner.cache.getQueryData(captured.infinite.queryKey)!;
				await report("modes-final", {
					...owner.metrics(),
					pages: page.pages.map((value) => value.nodes[0]?.reference).join(","),
					duplicatePages:
						document.querySelector("#suspense-pages")?.textContent,
					terminal: page.pages.at(-1)?.pageInfo.hasNextPage === false,
					ordinaryDate:
						owner.cache.getQueryData(captured.ordinary.queryKey)
							?.updatedAt instanceof Date,
					infiniteDate: page.pages[0]?.nodes[0]?.updatedAt instanceof Date,
					liveSummary: owner.cache.getQueryData(captured.live.queryKey)
						?.summary,
				});
			} else {
				// Observe a browser task window after readiness; cancellation must not dispatch later.
				await new Promise<void>((resolve) => setTimeout(resolve, 100));
				const oldDispatches =
					owner.metrics().browserCalls + owner.metrics().streams;
				let oldOptionsRejected = false;
				let replacementDate = false;
				const retiredData = keys.filter(
					(queryKey) => owner.cache.getQueryData(queryKey) !== undefined,
				).length;
				if (scenario === "retire") {
					oldOptionsRejected = (
						await Promise.all(
							[
								owner.cache.fetchQuery(captured.ordinary),
								owner.cache.fetchInfiniteQuery(captured.infinite),
								owner.cache.fetchQuery(captured.live),
							].map((operation) =>
								operation.then(
									() => false,
									(error: unknown) =>
										error instanceof Error && error.message === "SCOPE_RETIRED",
								),
							),
						)
					).every(Boolean);
					const replacement = owner.replaceOrdinaryScope();
					replacementDate =
						(
							await owner.cache.fetchQuery(
								replacement.queries["tasks.summary"].options({ id: firstId }),
							)
						)?.updatedAt instanceof Date;
				}
				await report("modes-final", {
					...owner.metrics(),
					oldDispatches,
					cancelled,
					retiredData,
					oldOptionsRejected,
					replacementDate,
				});
			}
		})().catch(() => {
			void report("browser-error", {});
		});
	}, [owner, captured]);
	return (
		<main>
			<h1>Native execution modes</h1>
			<p id="ordinary-time">{ordinary.data?.updatedAt.toISOString()}</p>
			<p id="infinite-pages">
				{infinite.data?.pages.map((page) => page.nodes[0]?.summary).join(",")}
			</p>
			<p id="live-summary">{live.data?.summary}</p>
			<button
				ref={nextPage}
				onClick={() => {
					pageOperation.current = infinite.fetchNextPage();
				}}
			>
				Next page
			</button>
			<button
				ref={refetchPages}
				onClick={() => {
					pageOperation.current = infinite.refetch();
				}}
			>
				Refetch retained pages
			</button>
			{!retired ? <SuspensePages options={captured.infinite} /> : null}
		</main>
	);
}

function SuspensePages({
	options,
}: {
	options: ReturnType<
		ReturnType<
			typeof import("../data/questpie").createOwner
		>["api"]["queries"]["tickets.queue"]["infiniteOptions"]
	>;
}) {
	const { data } = useSuspenseInfiniteQuery({ ...options, maxPages: 2 });
	return (
		<p id="suspense-pages">
			{data.pages.map((page) => page.nodes[0]?.reference).join(",")}
		</p>
	);
}
