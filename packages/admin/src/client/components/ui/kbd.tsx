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
				"qa-kbd rounded-xs bg-muted text-muted-foreground pointer-events-none inline-flex h-5 items-center gap-1 border px-1.5 font-mono text-[10px] font-medium select-none",
				className,
			)}
			{...props}
		>
			{children}
		</kbd>
	);
}
