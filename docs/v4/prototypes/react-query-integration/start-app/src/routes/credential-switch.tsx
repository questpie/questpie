import {
	MutationObserver,
	useMutation,
	useQuery,
	useSuspenseQuery,
} from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useRef, useState } from "react";

import { firstId, streamedId } from "../data/questpie";
import type { createOwner } from "../data/questpie";
import { report } from "../tracer/scenario";

type Adapter = ReturnType<ReturnType<typeof createOwner>["replaceScope"]>;
export const Route = createFileRoute("/credential-switch")({
	loader: ({ context }) =>
		context.owner.cache.ensureQueryData(
			context.owner.api.queries["tasks.detail"].options({ id: firstId }),
		),
	component: CredentialSwitch,
});
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function CredentialSwitch() {
	const { owner } = Route.useRouteContext();
	const [original] = useState(() => owner.api);
	const [captured] = useState(() => ({
		query: original.queries["tasks.detail"].options({ id: firstId }),
		streamed: original.queries["tasks.detail"].options({ id: streamedId }),
		mutation: original.mutations["tasks.transition"].options(),
	}));
	const query = useQuery(captured.query);
	const previous = useMutation(captured.mutation);
	const pending = useMutation(captured.mutation);
	const [next, setNext] = useState<Adapter>();
	const [retiring, setRetiring] = useState(false);
	const started = useRef(false);
	const outcome = useRef("pending");
	const facts = useRef({
		oldQueryRejected: false,
		oldMutationRejected: false,
		differentKey: false,
	});
	useEffect(() => {
		if (started.current || !query.data) return;
		started.current = true;
		void (async () => {
			const variables = {
				id: firstId,
				expectedVersion: 1,
				targetStatus: "done" as const,
			};
			await previous.mutateAsync(variables);
			await tick();
			await report("credential-before-switch", {
				query: document.querySelector("#old-query")?.textContent,
				mutation: document.querySelector("#old-mutation")?.textContent,
			});
			const late = pending
				.mutateAsync({ ...variables, expectedVersion: 2 })
				.then(
					() => {
						outcome.current = "unexpected-success";
					},
					(error) => {
						outcome.current = error?.outcome?.kind ?? "unclassified";
					},
				);
			await fetch("/__credential-switch", { method: "POST" });
			await report("credential-pending", {
				status: document.querySelector("#old-pending")?.textContent,
				variables: document.querySelector("#old-variables")?.textContent,
			});
			setRetiring(true);
			await tick();
			await original.dispose();
			await tick();
			await tick();
			await report("credential-retired", {
				query: document.querySelector("#old-query")?.textContent,
				mutation: document.querySelector("#old-mutation")?.textContent,
				pending: document.querySelector("#old-pending")?.textContent,
				variables: document.querySelector("#old-variables")?.textContent,
			});
			facts.current.oldQueryRejected = await owner.cache
				.fetchQuery(captured.query)
				.then(
					() => false,
					(error) => error?.message === "SCOPE_RETIRED",
				);
			const retained = new MutationObserver(owner.cache, captured.mutation);
			facts.current.oldMutationRejected = await retained.mutate(variables).then(
				() => false,
				(error) =>
					error?.code === "SCOPE_RETIRED" &&
					error.outcome.kind === "not-dispatched",
			);
			retained.reset();
			const replacement = owner.replaceScope();
			facts.current.differentKey =
				JSON.stringify(captured.query.queryKey) !==
				JSON.stringify(
					replacement.queries["tasks.detail"].options({ id: firstId }).queryKey,
				);
			setNext(replacement);
			await report("credential-switched", {});
			await late;
		})().catch(() => {
			void report("browser-error", {});
		});
	}, [query.data, previous, pending, original, captured, owner]);
	return (
		<main>
			<h1>Credential lifetime tracer</h1>
			<p id="old-query">
				{query.isError ? "Retired Query" : (query.data?.title ?? "Loading")}
			</p>
			<p id="old-mutation">{previous.data?.title ?? "No Mutation result"}</p>
			<p id="old-pending">{pending.status}</p>
			<p id="old-variables">
				{pending.variables?.targetStatus ?? "No pending input"}
			</p>
			{next ? (
				<Current
					adapter={next}
					outcome={outcome}
					facts={facts}
					oldKey={captured.query.queryKey}
					oldStream={captured.streamed}
				/>
			) : !retiring ? (
				<Suspense fallback={<p>Old streamed Query pending</p>}>
					<OldStream adapter={original} />
				</Suspense>
			) : null}
		</main>
	);
}
function OldStream({ adapter }: { adapter: Adapter }) {
	const { data } = useSuspenseQuery(
		adapter.queries["tasks.detail"].options({ id: streamedId }),
	);
	return <p id="old-streamed">{data?.title}</p>;
}
function Current({
	adapter,
	outcome,
	facts,
	oldKey,
	oldStream,
}: {
	adapter: Adapter;
	outcome: { current: string };
	facts: { current: object };
	oldKey: readonly string[];
	oldStream: ReturnType<Adapter["queries"]["tasks.detail"]["options"]>;
}) {
	const { owner } = Route.useRouteContext();
	const { data, status, error } = useQuery(
		adapter.queries["tasks.detail"].options({ id: firstId }),
	);
	useEffect(() => {
		void report("credential-current-state", {
			status,
			error: error instanceof Error ? error.message : null,
			title: data?.title,
			ready: document.readyState,
		});
	}, [status, error, data]);
	useEffect(() => {
		if (data?.title !== "New credential task") return;
		const timer = setTimeout(async () => {
			const oldCachedData = owner.cache
				.getQueryCache()
				.findAll({ queryKey: oldKey.slice(0, 2) })
				.filter((query) => query.state.data !== undefined).length;
			const oldStreamRejected = await owner.cache.fetchQuery(oldStream).then(
				() => false,
				(error) => error?.message === "SCOPE_RETIRED",
			);
			void report("credential-final", {
				title: data.title,
				oldVisible:
					document.body.textContent?.includes("Old credential task") ||
					document.body.textContent?.includes("Old committed result") ||
					document.body.textContent?.includes("Late old committed result"),
				oldCachedData,
				oldStreamRejected,
				cookieHidden: !document.cookie.includes("proof-session"),
				lateOutcome: outcome.current,
				...facts.current,
			});
		}, 300);
		return () => clearTimeout(timer);
	}, [data, outcome, facts, owner, oldKey, oldStream]);
	return <p id="new-query">{data?.title ?? "Waiting for new credential"}</p>;
}
