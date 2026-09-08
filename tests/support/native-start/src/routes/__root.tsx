import {
	HeadContent,
	Outlet,
	Scripts,
	createRootRouteWithContext,
} from "@tanstack/react-router";

import type { createOwner } from "../data/questpie";

export const Route = createRootRouteWithContext<{
	owner: ReturnType<typeof createOwner>;
}>()({
	head: () => ({
		meta: [
			{ charSet: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{ title: "QUESTPIE Start SSR tracer" },
		],
	}),
	component: () => (
		<html lang="en">
			<head>
				<HeadContent />
				<script src="/__fault-observer.js" />
			</head>
			<body>
				<img src="/__load-barrier" alt="" width="1" height="1" />
				<Outlet />
				<Scripts />
			</body>
		</html>
	),
});
