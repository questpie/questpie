import type * as React from "react";

import { cn } from "../../lib/utils";

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
	return (
		<textarea
			data-slot="textarea"
			className={cn(
				"border-input/80 bg-input/20  backdrop-blur-sm focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 resize-none border px-3 py-2.5 text-sm transition-all focus-visible:ring-[2px] aria-invalid:ring-[2px] placeholder:text-muted-foreground flex field-sizing-content min-h-24 w-full outline-none disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		/>
	);
}

export { Textarea };
