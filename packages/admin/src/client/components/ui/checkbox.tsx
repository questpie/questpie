import { Checkbox as CheckboxPrimitive } from "@base-ui/react/checkbox";
import { Icon } from "@iconify/react";

import { cn } from "../../lib/utils";

function Checkbox({
	className,
	indeterminate,
	...props
}: CheckboxPrimitive.Root.Props & { indeterminate?: boolean }) {
	// Determine which icon to show based on state
	const showIndeterminate = indeterminate && !props.checked;

	return (
		<CheckboxPrimitive.Root
			data-slot="checkbox"
			indeterminate={indeterminate}
			className={cn(
				"qa-checkbox border-input bg-card data-checked:border-border-strong data-checked:bg-surface-high data-checked:text-foreground data-indeterminate:border-border-strong data-indeterminate:bg-surface-high data-indeterminate:text-foreground aria-invalid:border-border-strong focus-visible:border-ring focus-visible:ring-ring/20 aria-invalid:ring-ring/20 peer relative flex size-4 shrink-0 items-center justify-center rounded-xs border transition-[background-color,border-color,box-shadow,color] duration-150 ease-out outline-none group-has-disabled/field:opacity-50 after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-[3px]",
				className,
			)}
			{...props}
		>
			{/* Indicator for checked state */}
			<CheckboxPrimitive.Indicator
				data-slot="checkbox-indicator"
				className={cn(
					"grid place-content-center text-current transition-none [&>svg]:size-3.5",
					showIndeterminate && "hidden",
				)}
			>
				<Icon icon="ph:check" />
			</CheckboxPrimitive.Indicator>
			{/* Manual indicator for indeterminate state */}
			{showIndeterminate && (
				<span className="grid place-content-center text-current [&>svg]:size-3.5">
					<Icon icon="ph:minus" />
				</span>
			)}
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
