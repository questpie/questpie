import type * as React from "react";

import { cn } from "../../lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"qa-textarea control-surface font-chrome focus-visible:border-border-strong focus-visible:ring-ring/20 aria-invalid:border-border-strong aria-invalid:ring-ring/20 placeholder:text-muted-foreground flex h-auto min-h-24 w-full resize-none px-3 py-2.5 text-sm outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-[3px]",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
