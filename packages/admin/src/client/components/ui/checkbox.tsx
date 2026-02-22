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
				"border-input data-checked:bg-primary data-checked:text-primary-foreground data-indeterminate:bg-primary data-indeterminate:text-primary-foreground dark:data-checked:bg-primary dark:data-indeterminate:bg-primary data-checked:border-primary data-indeterminate:border-primary aria-invalid:aria-checked:border-primary aria-invalid:border-destructive dark:aria-invalid:border-destructive/50 focus-visible:border-ring focus-visible:ring-ring/30 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 flex size-4 items-center justify-center border transition-shadow group-has-disabled/field:opacity-50 focus-visible:ring-[2px] aria-invalid:ring-[2px] peer relative shrink-0 outline-none after:absolute after:-inset-x-3 after:-inset-y-2 disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...props}
		>
			{/* Indicator for checked state */}
			<CheckboxPrimitive.Indicator
				data-slot="checkbox-indicator"
				className={cn(
					"[&>svg]:size-3.5 grid place-content-center text-current transition-none",
					showIndeterminate && "hidden",
				)}
			>
				<Icon icon="ph:check-bold" />
			</CheckboxPrimitive.Indicator>
			{/* Manual indicator for indeterminate state */}
			{showIndeterminate && (
				<span className="[&>svg]:size-3.5 grid place-content-center text-current">
					<Icon icon="ph:minus-bold" />
				</span>
			)}
		</CheckboxPrimitive.Root>
	);
}

export { Checkbox };
