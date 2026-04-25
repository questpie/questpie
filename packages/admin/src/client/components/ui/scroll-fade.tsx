import * as React from "react";

import { cn } from "../../lib/utils";

type ScrollFadeOrientation = "horizontal" | "vertical" | "both";

interface ScrollFadeProps extends React.ComponentProps<"div"> {
	orientation?: ScrollFadeOrientation;
	/** Gradient width/height in pixels */
	fadeSize?: number;
	/** Left inset in pixels — use to skip sticky columns */
	leftInset?: number;
}

function ScrollFade({
	orientation = "horizontal",
	fadeSize = 20,
	leftInset = 0,
	children,
	className,
	...props
}: ScrollFadeProps) {
	const wrapperRef = React.useRef<HTMLDivElement>(null);
	const [overflow, setOverflow] = React.useState({
		left: false,
		right: false,
		top: false,
		bottom: false,
	});

	React.useEffect(() => {
		const wrapper = wrapperRef.current;
		if (!wrapper) return;

		const scrollable =
			wrapper.querySelector<HTMLElement>("[data-scroll-fade-target]") ??
			wrapper.querySelector<HTMLElement>(
				".overflow-x-auto, .overflow-y-auto, .overflow-auto",
			) ??
			wrapper;

		const update = () => {
			const el = scrollable;
			const h = orientation !== "vertical";
			const v = orientation !== "horizontal";
			setOverflow({
				left: h && el.scrollLeft > 1,
				right:
					h && el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
				top: v && el.scrollTop > 1,
				bottom:
					v && el.scrollTop + el.clientHeight < el.scrollHeight - 1,
			});
		};

		update();
		scrollable.addEventListener("scroll", update, { passive: true });
		const observer = new ResizeObserver(update);
		observer.observe(scrollable);

		return () => {
			scrollable.removeEventListener("scroll", update);
			observer.disconnect();
		};
	}, [orientation]);

	const h = orientation !== "vertical";
	const v = orientation !== "horizontal";
	const fade =
		"pointer-events-none absolute z-30 transition-opacity duration-200";

	return (
		<div ref={wrapperRef} className={cn("relative", className)} {...props}>
			{children}
			{h && (
				<div
					className={cn(
						fade,
						"inset-y-0 bg-gradient-to-r from-background to-transparent",
						overflow.left ? "opacity-100" : "opacity-0",
					)}
					style={{ left: leftInset, width: fadeSize }}
					aria-hidden
				/>
			)}
			{h && (
				<div
					className={cn(
						fade,
						"inset-y-0 right-0 bg-gradient-to-l from-background to-transparent",
						overflow.right ? "opacity-100" : "opacity-0",
					)}
					style={{ width: fadeSize }}
					aria-hidden
				/>
			)}
			{v && (
				<div
					className={cn(
						fade,
						"inset-x-0 top-0 bg-gradient-to-b from-background to-transparent",
						overflow.top ? "opacity-100" : "opacity-0",
					)}
					style={{ height: fadeSize }}
					aria-hidden
				/>
			)}
			{v && (
				<div
					className={cn(
						fade,
						"inset-x-0 bottom-0 bg-gradient-to-t from-background to-transparent",
						overflow.bottom ? "opacity-100" : "opacity-0",
					)}
					style={{ height: fadeSize }}
					aria-hidden
				/>
			)}
		</div>
	);
}

export { ScrollFade };
export type { ScrollFadeProps };
