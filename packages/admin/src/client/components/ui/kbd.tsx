import { cn } from "../../lib/utils";

interface KbdProps extends React.HTMLAttributes<HTMLElement> {
	children: React.ReactNode;
}

/**
 * Keyboard shortcut badge component
 *
 * @example
 * ```tsx
 * <Kbd>⌘K</Kbd>
 * <Kbd>ESC</Kbd>
 * ```
 */
export function Kbd({ className, children, ...props }: KbdProps) {
	return (
		<kbd
			className={cn(
				"pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground",
				className,
			)}
			{...props}
		>
			{children}
		</kbd>
	);
}
