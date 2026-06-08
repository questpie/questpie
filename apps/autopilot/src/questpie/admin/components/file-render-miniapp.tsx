"use client";

import { appIdFromPath, type KnowledgeDoc } from "../lib/knowledge-doc";
import { KnowledgeHost } from "./knowledge-host";

/**
 * Mini-app row: mount the KnowledgeHost iframe runtime (it reads the `.app`
 * bundle itself — no `body` on the opened row is required). The `.app` bundle is
 * a subtree; any of its rows resolves to the same app id via the path.
 */
export default function FileRenderMiniapp({ doc }: { doc: KnowledgeDoc }) {
	const appId = appIdFromPath(doc.path);
	if (!appId) {
		return (
			<div className="text-foreground-muted border-border-subtle rounded-[var(--surface-radius)] border px-4 py-8 text-center text-sm">
				This mini-app row is not inside a `.app` bundle path.
			</div>
		);
	}
	return (
		<div className="border-border-subtle bg-background overflow-hidden rounded-[var(--surface-radius)] border">
			<KnowledgeHost appId={appId} className="h-[36rem] w-full" />
		</div>
	);
}
