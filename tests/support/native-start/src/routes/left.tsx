import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";

import { report } from "../tracer/scenario";

export const Route = createFileRoute("/left")({ component: Left });

function Left() {
	const { owner } = Route.useRouteContext();
	useEffect(() => {
		void report("left-mounted", owner.metrics());
	}, [owner]);
	return <h1 id="left">Navigated away from pending SSR Query</h1>;
}
