"use client";

import { Tooltip as TooltipPrimitive } from "@base-ui/react/tooltip";

import { cn } from "#questpie/admin/client/lib/utils.js";

function TooltipProvider({
	delay = 0,
	...props
}: TooltipPrimitive.Provider.Props) {
	return (
		<TooltipPrimitive.Provider
			data-slot="tooltip-provider"
			delay={delay}
			{...props}
		/>
	);
}

function Tooltip({ ...props }: TooltipPrimitive.Root.Props) {
	return (
		<TooltipProvider>
			<TooltipPrimitive.Root data-slot="tooltip" {...props} />
		</TooltipProvider>
	);
}

function TooltipTrigger({ ...props }: TooltipPrimitive.Trigger.Props) {
	return <TooltipPrimitive.Trigger data-slot="tooltip-trigger" {...props} />;
}

function TooltipContent({
	className,
	side = "top",
	sideOffset = 4,
	align = "center",
	alignOffset = 0,
	children,
	...props
}: TooltipPrimitive.Popup.Props &
	Pick<
		TooltipPrimitive.Positioner.Props,
		"align" | "alignOffset" | "side" | "sideOffset"
	>) {
	return (
		<TooltipPrimitive.Portal>
			<TooltipPrimitive.Positioner
				align={align}
				alignOffset={alignOffset}
				side={side}
				sideOffset={sideOffset}
				className="isolate z-50"
			>
				<TooltipPrimitive.Popup
					data-slot="tooltip-content"
					className={cn(
						"qa-tooltip__content floating-surface motion-floating-fast font-chrome text-popover-foreground z-50 w-fit max-w-xs origin-(--transform-origin) px-2.5 py-1.5 text-xs data-ending-style:scale-[var(--motion-scale-enter)] data-ending-style:opacity-0 data-starting-style:scale-[var(--motion-scale-enter)] data-starting-style:opacity-0",
						className,
					)}
					{...props}
				>
					{children}
					{/* <TooltipPrimitive.Arrow
						className={cn(
							"size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] z-50 data-[side=bottom]:top-1 data-[side=left]:top-1/2! data-[side=left]:-right-1 data-[side=left]:-translate-y-1/2 data-[side=right]:top-1/2! data-[side=right]:-left-1 data-[side=right]:-translate-y-1/2 data-[side=top]:-bottom-2.5",
							"bg-card fill-card/10 border-border",
						)}
					/> */}
				</TooltipPrimitive.Popup>
			</TooltipPrimitive.Positioner>
		</TooltipPrimitive.Portal>
	);
}

export { Tooltip, TooltipTrigger, TooltipContent };
