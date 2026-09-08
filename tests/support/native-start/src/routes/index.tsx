import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { Suspense, useEffect, useRef, useState } from "react";

import { firstId, streamedId } from "../data/questpie";
import { report } from "../tracer/scenario";

export const Route = createFileRoute("/")({
	loader: ({ context }) =>
		context.owner.cache.ensureQueryData(
			context.owner.api.queries["tickets.detail"].options({ id: firstId }),
		),
	component: Page,
});

function Page() {
	const { owner } = Route.useRouteContext();
	const navigate = Route.useNavigate();
	const { data } = useSuspenseQuery(
		owner.api.queries["tickets.detail"].options({ id: firstId }),
	);
	useEffect(() => {
		if (data?.summary !== "Finite SSR task") return;
		void report("finite-before-ready", {
			isDate: data?.updatedAt instanceof Date,
			summary: data?.summary,
			...owner.metrics(),
		}).then(() => {
			if (
				new URL(window.location.href).searchParams.get("fault") === "navigate"
			)
				void navigate({ to: "/left" });
		});
	}, [data, owner, navigate]);
	useEffect(() => {
		if (data !== null) return;
		const timer = setTimeout(() => {
			void report("live-removed", {
				finiteText: document.querySelector("#finite")?.textContent,
				duplicateText: document.querySelector("#duplicate")?.textContent,
				streamedText: document.querySelector("#streamed")?.textContent,
				oldRowVisible: document.body.textContent?.includes("Finite SSR task"),
				...owner.metrics(),
			});
		}, 250);
		return () => clearTimeout(timer);
	}, [data, owner]);
	return (
		<main>
			<h1>QUESTPIE + TanStack Start</h1>
			<p id="finite">
				{data === null ? "Task removed by Policy" : data.summary}
			</p>
			<Duplicate />
			<Suspense fallback={<p id="stream-pending">Streaming task…</p>}>
				<Streamed />
			</Suspense>
		</main>
	);
}

function Duplicate() {
	const { owner } = Route.useRouteContext();
	const { data } = useSuspenseQuery(
		owner.api.queries["tickets.detail"].options({ id: firstId }),
	);
	return (
		<p id="duplicate">{data === null ? "No visible task" : data.summary}</p>
	);
}

function Streamed() {
	const { owner } = Route.useRouteContext();
	const { data } = useSuspenseQuery(
		owner.api.queries["tickets.detail"].options({ id: streamedId }),
	);
	const [clicked, setClicked] = useState(false);
	const button = useRef<HTMLButtonElement>(null);
	useEffect(() => {
		button.current?.click();
	}, []);
	useEffect(() => {
		if (!clicked || data?.summary !== "Streamed SSR task") return;
		void report("streamed-before-ready", {
			clicked,
			isDate: data?.updatedAt instanceof Date,
			iso: data?.updatedAt.toISOString(),
			summary: data?.summary,
			...owner.metrics(),
		});
	}, [clicked, data, owner]);
	return (
		<section>
			<h2 id="streamed">{data?.summary}</h2>
			<time dateTime={data?.updatedAt.toISOString()}>
				{data?.updatedAt.toISOString()}
			</time>
			<button ref={button} onClick={() => setClicked(true)}>
				{clicked ? "Hydrated and interactive" : "Check hydration"}
			</button>
		</section>
	);
}
