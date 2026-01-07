"use client";

import { useState } from "react";
import { Copy, Check } from "@phosphor-icons/react";

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
			className="inline-flex items-center gap-1.5 rounded-md border border-fd-border bg-fd-secondary px-2 py-1 text-xs font-medium text-fd-secondary-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
			title="Copy markdown URL for AI"
		>
			{copied ? (
				<>
					<Check className="size-3.5" />
					Copied
				</>
			) : (
				<>
					<Copy className="size-3.5" />
					Copy for AI
				</>
			)}
		</button>
	);
}
