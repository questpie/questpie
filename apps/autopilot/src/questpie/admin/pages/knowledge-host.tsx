"use client";

import { Icon } from "@iconify/react";
import * as React from "react";

import { page } from "@questpie/admin/client";

import { KnowledgeHost } from "../components/knowledge-host";

/**
 * Full-screen mini-app runner page.
 *
 * `.private/miniapps-v2-design.md` §5 calls for `page("knowledge-host", { path:
 * "/apps/:appId" })`. The admin router's page matcher (`admin-router.tsx`
 * `matchRoute`) matches a page path LITERALLY (`first === pagePath ||
 * segments.join("/") === pagePath`) — it does NOT parse `:param` segments. So this
 * page is registered at the literal `/apps` and reads the app id from the `?app=`
 * query param (the same query-param convention `project-inspection` uses for
 * `?run=`). The canonical URL is therefore:
 *
 *     /admin/apps?app=<appId>            e.g. /admin/apps?app=social-scheduler
 *
 * Opening a `kind:"miniapp"` row in the Files detail view ALSO mounts the same
 * KnowledgeHost inline (see `knowledge-detail-component.tsx`), so this page is the
 * full-screen/deep-link entry point, not the only one.
 */

function useAppIdFromQuery(): string | null {
	const [appId, setAppId] = React.useState<string | null>(() => {
		if (typeof window === "undefined") return null;
		return new URLSearchParams(window.location.search).get("app");
	});
	// Track back/forward navigations that change the query.
	React.useEffect(() => {
		const onPop = () => {
			setAppId(new URLSearchParams(window.location.search).get("app"));
		};
		window.addEventListener("popstate", onPop);
		return () => window.removeEventListener("popstate", onPop);
	}, []);
	return appId;
}

function KnowledgeHostPage() {
	const appId = useAppIdFromQuery();

	if (!appId) {
		return (
			<div className="bg-background flex h-[calc(100vh-3.5rem)] flex-col items-center justify-center gap-2 text-center">
				<Icon icon="ph:app-window" className="text-muted-foreground size-8" />
				<div className="text-sm font-medium">No mini-app selected</div>
				<div className="text-muted-foreground max-w-md text-xs">
					Open a mini-app from the Files library, or pass{" "}
					<code>?app=&lt;appId&gt;</code> in the URL.
				</div>
			</div>
		);
	}

	return (
		<div className="bg-background flex h-[calc(100vh-3.5rem)] min-h-[620px] flex-col overflow-hidden">
			<div className="border-border-subtle flex h-12 shrink-0 items-center gap-2 border-b px-4">
				<Icon icon="ph:app-window" className="text-primary size-4" />
				<h1 className="text-sm font-semibold">{appId}</h1>
				<span className="text-muted-foreground ml-2 text-[11px]">mini-app</span>
			</div>
			<div className="min-h-0 flex-1">
				<KnowledgeHost appId={appId} className="h-full w-full" />
			</div>
		</div>
	);
}

export default page("knowledge-host", {
	path: "/apps",
	label: { en: "Mini-app" },
	component: KnowledgeHostPage,
	showInNav: false,
});
