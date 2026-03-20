"use client";

import { Icon } from "@iconify/react";
import { useState } from "react";

export function LLMCopyButton({ markdownUrl }: { markdownUrl: string }) {
	const [copied, setCopied] = useState(false);

	const handleCopy = async () => {
		const fullUrl = `${window.location.origin}${markdownUrl}`;
		await navigator.clipboard.writeText(fullUrl);
		setCopied(true);
		setTimeout(() => setCopied(false), 2000);
	};

	return (
		<button
			type="button"
			onClick={handleCopy}
			className="border-fd-border bg-fd-secondary text-fd-secondary-foreground hover:bg-fd-accent hover:text-fd-accent-foreground inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors"
			title="Copy markdown URL for AI"
		>
			{copied ? (
				<>
					<Icon icon="ph:check" className="size-3.5" />
					Copied
				</>
			) : (
				<>
					<Icon icon="ph:copy" className="size-3.5" />
					Copy for AI
				</>
			)}
		</button>
	);
}
