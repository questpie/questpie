"use client";

import { Icon } from "@iconify/react";
import { useState } from "react";

type State = "idle" | "copied" | "failed";

/* Copies the page, not a link to it.
 *
 * This used to copy `${origin}${url}.mdx`, which was wrong twice. A URL is not
 * what "Copy for AI" promises, and pasting a localhost address into a chat
 * gives the model nothing it can read. The address was also dead: the markdown
 * is served from `/llms.mdx/docs/$`, so `/docs/<path>.mdx` answered 404.
 *
 * The URL is still the fallback. If the fetch fails there is nothing better to
 * put on the clipboard, and on a deployed site the address does resolve. */
export function LLMCopyButton({ markdownPath }: { markdownPath: string }) {
	const [state, setState] = useState<State>("idle");

	const handleCopy = async () => {
		try {
			const response = await fetch(markdownPath);
			if (!response.ok) throw new Error(String(response.status));
			await navigator.clipboard.writeText(await response.text());
			setState("copied");
		} catch {
			/*
			 * The URL used to be a silent fallback here, reported as "Copied". When
			 * the markdown route was answering 500 in production, every click put an
			 * address on the clipboard and claimed it was the page. A button that
			 * says it copied something has to have copied that thing.
			 */
			setState("failed");
		}

		setTimeout(() => setState("idle"), 2000);
	};

	const label = {
		idle: "Copy as markdown",
		copied: "Copied",
		failed: "Copy failed",
	}[state];

	const icon = {
		idle: "ph:copy",
		copied: "ph:check",
		failed: "ph:warning",
	}[state];

	return (
		<button
			className="border-fd-border bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-accent hover:text-fd-accent-foreground inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors"
			onClick={handleCopy}
			title="Copy this page as markdown"
			type="button"
		>
			<Icon className="size-3.5" icon={icon} />
			{label}
		</button>
	);
}

/* The same markdown, openable rather than copied. An agent given the address can
 * fetch it, and a reader who wants to see what "as markdown" means can look
 * before trusting the clipboard. */
export function LLMViewLink({ markdownPath }: { markdownPath: string }) {
	return (
		<a
			className="border-fd-border text-fd-muted-foreground hover:bg-fd-accent hover:text-fd-accent-foreground inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors"
			href={markdownPath}
			rel="noreferrer"
			target="_blank"
			title="Open this page as markdown"
		>
			<Icon className="size-3.5" icon="ph:file-md" />
			View markdown
		</a>
	);
}
