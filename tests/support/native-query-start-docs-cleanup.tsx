// Test-only consumer of the actual public router owner; no alternate owner or transport.
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { flushSync } from "react-dom";

import { createOwner } from "../data/questpie";

export const Route = createFileRoute("/test-cleanup")({ component: Cleanup });

function Cleanup() {
	const { owner } = Route.useRouteContext();
	const [visible, setVisible] = useState(true);
	const [retired, setRetired] = useState(false);
	async function retire() {
		const unhydrated = createOwner(false);
		const identity = owner.api.dehydrate();
		const closing = unhydrated.dispose();
		const repeated = unhydrated.dispose();
		await closing;
		let resurrected = false;
		try {
			unhydrated.hydrate(identity);
			resurrected = true;
		} catch {}
		if (resurrected)
			throw new Error("Pre-bootstrap retirement allowed late hydration");
		if (closing !== repeated)
			throw new Error("Disposal did not share its completion Promise");
		flushSync(() => setVisible(false));
		await owner.dispose();
		setRetired(true);
	}
	return visible ? (
		<>
			<Ticket />
			<button
				id="retire"
				onClick={() => {
					void retire().catch((error) =>
						fetch("/__report", {
							method: "POST",
							body: JSON.stringify({
								ok: false,
								path: location.pathname,
								failure:
									error instanceof Error ? error.message : "Retirement failed",
							}),
						}),
					);
				}}
			>
				Retire
			</button>
		</>
	) : (
		<p id="retired">{retired ? "Owner retired" : "Retiring"}</p>
	);
}

function Ticket() {
	const { owner } = Route.useRouteContext();
	const { data } = useSuspenseQuery(
		owner.api.queries["tickets.detailPage"].options({
			ids: [owner.ticketId],
			first: 1,
			after: null,
		}),
	);
	const ticket = data.nodes[0];
	return (
		<article>
			<h1>{ticket?.summary}</h1>
			<time dateTime={ticket?.comments[0]?.createdAt.toISOString()} />
		</article>
	);
}
