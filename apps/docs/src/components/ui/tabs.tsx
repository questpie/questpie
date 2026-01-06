import * as React from "react";
import { cn } from "@/lib/utils";

const Tabs = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement> & {
		value?: string;
		onValueChange?: (value: string) => void;
		defaultValue?: string;
	}
>(
	(
		{ className, value, onValueChange, defaultValue, children, ...props },
		ref,
	) => {
		const [selectedValue, setSelectedValue] = React.useState(
			value || defaultValue,
		);

		React.useEffect(() => {
			if (value !== undefined) {
				setSelectedValue(value);
			}
		}, [value]);

		const contextValue = React.useMemo(
			() => ({
				value: selectedValue,
				onValueChange: (val: string) => {
					if (onValueChange) {
						onValueChange(val);
					} else {
						setSelectedValue(val);
					}
				},
			}),
			[selectedValue, onValueChange],
		);

		return (
			<TabsContext.Provider value={contextValue}>
				<div ref={ref} className={cn("w-full", className)} {...props}>
					{children}
				</div>
			</TabsContext.Provider>
		);
	},
);
Tabs.displayName = "Tabs";

const TabsContext = React.createContext<{
	value?: string;
	onValueChange: (value: string) => void;
} | null>(null);

const TabsList = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
	<div
		ref={ref}
		className={cn(
			"inline-flex h-9 items-center justify-center border border-border bg-card/30 p-1 text-muted-foreground backdrop-blur-sm",
			className,
		)}
		{...props}
	/>
));
TabsList.displayName = "TabsList";

const TabsTrigger = React.forwardRef<
	HTMLButtonElement,
	React.ButtonHTMLAttributes<HTMLButtonElement> & { value: string }
>(({ className, value, onClick, ...props }, ref) => {
	const context = React.useContext(TabsContext);
	const isSelected = context?.value === value;

	return (
		<button
			ref={ref}
			type="button"
			className={cn(
				"inline-flex items-center cursor-pointer rounded-none justify-center whitespace-nowrap px-3 py-1 text-xs font-medium ring-offset-background transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 hover:text-foreground",
				isSelected &&
					"bg-primary/10 text-primary  shadow-primary/10  shadow-[0_0_20px_-2px]",
				className,
			)}
			onClick={(e) => {
				context?.onValueChange(value);
				onClick?.(e);
			}}
			{...props}
		/>
	);
});
TabsTrigger.displayName = "TabsTrigger";

const TabsContent = React.forwardRef<
	HTMLDivElement,
	React.HTMLAttributes<HTMLDivElement> & { value: string }
>(({ className, value, ...props }, ref) => {
	const context = React.useContext(TabsContext);
	if (context?.value !== value) return null;

	return (
		<div
			ref={ref}
			className={cn(
				"mt-2 ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 animate-in fade-in zoom-in-95 duration-200",
				className,
			)}
			{...props}
		/>
	);
});
TabsContent.displayName = "TabsContent";

export { Tabs, TabsList, TabsTrigger, TabsContent };
