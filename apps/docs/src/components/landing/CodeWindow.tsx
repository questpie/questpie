import { cn } from "@/lib/utils";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
	coldarkCold,
	coldarkDark,
} from "react-syntax-highlighter/dist/esm/styles/prism";

interface CodeWindowProps {
	title?: string;
	children: string;
	className?: string;
	language?: string;
}

export function CodeWindow({
	title,
	children,
	className,
	language = "typescript",
}: CodeWindowProps) {
	return (
		<div
			className={cn(
				"flex flex-col border border-border overflow-hidden",
				className,
			)}
		>
			{/* VSCode-like tab */}
			{title && (
				<div className="flex items-center bg-card/30 border-b border-border">
					<div className="flex items-center gap-2 px-4 py-2.5 text-sm font-mono border-r border-border bg-background text-foreground relative min-w-fit">
						{/* File icon based on extension */}
						<span
							className={cn(
								"w-2 h-2 rounded-full",
								title.endsWith(".ts")
									? "bg-blue-500"
									: title.endsWith(".tsx")
										? "bg-cyan-500"
										: title.endsWith(".js")
											? "bg-yellow-500"
											: title.endsWith(".jsx")
												? "bg-yellow-400"
												: "bg-gray-500",
							)}
						/>
						{/* Filename */}
						<span className="select-none">{title}</span>
						{/* Active indicator */}
						<div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
					</div>
				</div>
			)}

			{/* Code content */}
			<div className="flex-1 bg-background p-6 overflow-auto">
				{/* Light mode */}
				<div className="dark:hidden">
					<SyntaxHighlighter
						language={language}
						style={coldarkCold}
						customStyle={{
							background: "transparent",
							padding: 0,
							margin: 0,
							fontSize: "0.875rem",
						}}
						showLineNumbers={true}
						wrapLines={true}
					>
						{children}
					</SyntaxHighlighter>
				</div>

				{/* Dark mode */}
				<div className="hidden dark:block">
					<SyntaxHighlighter
						language={language}
						style={coldarkDark}
						customStyle={{
							background: "transparent",
							padding: 0,
							margin: 0,
							fontSize: "0.875rem",
						}}
						showLineNumbers={true}
						wrapLines={true}
					>
						{children}
					</SyntaxHighlighter>
				</div>
			</div>
		</div>
	);
}
