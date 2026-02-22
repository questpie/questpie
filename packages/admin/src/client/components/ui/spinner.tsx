import { Icon } from "@iconify/react";
import { cn } from "../../lib/utils";

function Spinner({ className, ...props }: { className?: string }) {
	return (
		<Icon
			icon="ph:spinner"
			role="status"
			aria-label="Loading"
			className={cn("size-4 animate-spin", className)}
			{...props}
		/>
	);
}

export { Spinner };
