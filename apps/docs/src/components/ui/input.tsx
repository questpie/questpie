import { Input as InputPrimitive } from "@base-ui/react/input";
import type * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
	return (
		<InputPrimitive
			type={type}
			data-slot="input"
			className={cn(
				"control-surface font-chrome focus-visible:border-border-strong focus-visible:ring-ring/20 focus:border-border-strong focus:ring-ring/20 aria-invalid:border-border-strong aria-invalid:ring-ring/20 file:text-foreground placeholder:text-muted-foreground w-full min-w-0 px-3 py-2 text-sm outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium focus:ring-[3px] focus-visible:ring-[3px] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-[3px]",
				className,
			)}
			{...props}
		/>
	);
}

export { Input };
