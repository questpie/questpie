import { Icon } from "@iconify/react";

import { cn } from "../../lib/utils";

function Spinner({ className, ...props }: { className?: string }) {
	return (
		<span
			className={cn("qa-spinner inline-flex size-4 animate-spin", className)}
		>
			<Icon
				icon="ph:spinner"
				role="status"
				aria-label="Loading"
				className="size-full"
				{...props}
			/>
		</span>
	);
}

export { Spinner };
