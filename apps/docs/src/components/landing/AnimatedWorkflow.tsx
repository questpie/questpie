import { useState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import {
	coldarkCold,
	coldarkDark,
} from "react-syntax-highlighter/dist/esm/styles/prism";
import { X, FileCode, Sparkles, CheckCircle } from "lucide-react";

interface LinePatch {
	line: number;
	code: string;
}

interface WorkflowStep {
	id: number;
	file: string;
	code?: string;
	language?: string;
	action?: string;
	mode?: "full" | "patch";
	patches?: LinePatch[];
}

interface AnimatedWorkflowProps {
	steps: WorkflowStep[];
	className?: string;
}

export function AnimatedWorkflow({ steps, className }: AnimatedWorkflowProps) {
	const [activeStepIndex, setActiveStepIndex] = useState(0);
	const [displayedCode, setDisplayedCode] = useState("");
	const [isTyping, setIsTyping] = useState(false);
	const [isPaused, setIsPaused] = useState(false);
	const [currentAction, setCurrentAction] = useState("");

	// Track cumulative code for each file
	const [_fileContents, setFileContents] = useState<Map<string, string>>(
		new Map(),
	);

	const displayedCodeRef = useRef("");
	const targetCodeRef = useRef(steps[0]?.code || "");
	const activeStepRef = useRef(0);
	const isTypingRef = useRef(false);
	const codeContainerRef = useRef<HTMLDivElement>(null);
	const activeTabRef = useRef<HTMLButtonElement>(null);
	const tabsContainerRef = useRef<HTMLDivElement>(null);
	const fileContentsRef = useRef<Map<string, string>>(new Map());

	// Get unique files for tabs (deduplicated)
	const uniqueFiles = Array.from(new Set(steps.map((s) => s.file)));
	const currentFile = steps[activeStepIndex]?.file;

	// Helper function to apply line-based patches
	const applyPatches = (baseCode: string, patches: LinePatch[]): string => {
		const lines = baseCode.split("\n");

		// Sort patches by line number (descending) to avoid index shifting
		const sortedPatches = [...patches].sort((a, b) => b.line - a.line);

		for (const patch of sortedPatches) {
			if (patch.line === -1) {
				// Append to end
				lines.push(patch.code);
			} else if (patch.line === 0) {
				// Prepend to start
				lines.unshift(patch.code);
			} else {
				// Insert after line N (1-indexed)
				lines.splice(patch.line, 0, patch.code);
			}
		}

		return lines.join("\n");
	};

	// Update target when step changes
	// biome-ignore lint/correctness/useExhaustiveDependencies: <explanation>
	useEffect(() => {
		const currentStep = steps[activeStepIndex];
		if (!currentStep) return;

		activeStepRef.current = activeStepIndex;
		setCurrentAction(currentStep.action || `Editing ${currentStep.file}`);

		// Calculate target code based on mode
		let newTarget: string;
		if (currentStep.mode === "patch" && currentStep.patches) {
			// Apply line-based patches to existing file content
			const existing = fileContentsRef.current.get(currentStep.file) || "";
			newTarget = applyPatches(existing, currentStep.patches);
		} else {
			// Full replacement
			newTarget = currentStep.code || "";
		}

		targetCodeRef.current = newTarget;

		// Scroll active tab into view (only within tabs container, not page)
		if (activeTabRef.current && tabsContainerRef.current) {
			const container = tabsContainerRef.current;
			const tab = activeTabRef.current;
			const containerRect = container.getBoundingClientRect();
			const tabRect = tab.getBoundingClientRect();

			// Only scroll if tab is outside container viewport
			if (
				tabRect.left < containerRect.left ||
				tabRect.right > containerRect.right
			) {
				const scrollLeft =
					tab.offsetLeft -
					container.offsetLeft -
					container.clientWidth / 2 +
					tab.clientWidth / 2;
				container.scrollTo({
					left: scrollLeft,
					behavior: "smooth",
				});
			}
		}
	}, [activeStepIndex, steps]);

	// Main animation loop
	useEffect(() => {
		if (isPaused) return;

		let isRunning = true;
		let pauseTimeout: NodeJS.Timeout | null = null;

		const loop = async () => {
			while (isRunning) {
				const current = displayedCodeRef.current;
				const target = targetCodeRef.current;

				// Check if we've completed typing the current step
				if (current === target) {
					if (isTypingRef.current) {
						// Just finished typing, start pause
						isTypingRef.current = false;
						setIsTyping(false);
						setCurrentAction("✓ Complete");

						// Save completed code to file history
						const currentStep = steps[activeStepRef.current];
						if (currentStep) {
							fileContentsRef.current.set(currentStep.file, target);
							setFileContents(new Map(fileContentsRef.current));
						}

						// Wait 1.5 seconds before moving to next step
						await new Promise((r) => {
							pauseTimeout = setTimeout(r, 1500);
						});

						if (!isRunning) break;

						// Move to next step (loop back to start)
						const nextIndex = (activeStepRef.current + 1) % steps.length;
						setActiveStepIndex(nextIndex);

						// For patch mode, start from existing content
						const nextStep = steps[nextIndex];
						if (nextStep?.mode === "patch") {
							const existingContent =
								fileContentsRef.current.get(nextStep.file) || "";
							displayedCodeRef.current = existingContent;
							setDisplayedCode(existingContent);
						} else {
							displayedCodeRef.current = "";
							setDisplayedCode("");
						}

						await new Promise((r) => setTimeout(r, 100));
						continue;
					}

					// Still waiting
					await new Promise((r) => setTimeout(r, 100));
					continue;
				}

				// Start typing if not already
				if (!isTypingRef.current) {
					isTypingRef.current = true;
					setIsTyping(true);
				}

				let nextStr = current;

				// Calculate common prefix
				let prefixLen = 0;
				const minLen = Math.min(current.length, target.length);
				while (prefixLen < minLen && current[prefixLen] === target[prefixLen]) {
					prefixLen++;
				}

				if (current.length > prefixLen) {
					// Delete characters (faster deletion)
					const dist = current.length - prefixLen;
					const deleteChunk = Math.max(1, Math.floor(dist / 2));
					nextStr = current.slice(0, -deleteChunk);
				} else {
					// Type new characters (3 chars at a time)
					const chunk = 3;
					nextStr = target.slice(0, current.length + chunk);
				}

				displayedCodeRef.current = nextStr;
				setDisplayedCode(nextStr);

				// Auto-scroll code container to bottom (where typing happens)
				// Only scroll the container itself, not the whole page
				if (codeContainerRef.current) {
					const container = codeContainerRef.current;
					// Calculate approximate line height and scroll to keep typing visible
					const lineCount = nextStr.split("\n").length;
					const approximateHeight = lineCount * 21; // ~21px per line with line numbers
					const containerHeight = container.clientHeight;

					// Scroll to keep last few lines visible (smooth scroll within container only)
					if (approximateHeight > containerHeight) {
						const targetScrollTop = approximateHeight - containerHeight + 100;
						// Use scrollTop directly to avoid affecting page scroll
						if (Math.abs(container.scrollTop - targetScrollTop) > 50) {
							container.scrollTop = targetScrollTop;
						}
					}
				}

				// Typing speed
				await new Promise((r) => setTimeout(r, 20));
			}
		};

		loop();

		return () => {
			isRunning = false;
			if (pauseTimeout) clearTimeout(pauseTimeout);
		};
	}, [isPaused, steps]);

	const handleTabClick = (fileName: string) => {
		// Find the first step with this file
		const stepIndex = steps.findIndex((s) => s.file === fileName);
		if (stepIndex !== -1) {
			setActiveStepIndex(stepIndex);
			setIsPaused(true);

			// Show existing content if file was already edited
			const existingContent = fileContentsRef.current.get(fileName) || "";
			displayedCodeRef.current = existingContent;
			setDisplayedCode(existingContent);

			// Resume after 5 seconds
			setTimeout(() => {
				setIsPaused(false);
			}, 5000);
		}
	};

	const activeStep = steps[activeStepIndex];

	return (
		<div className={cn("flex flex-col relative", className)}>
			{/* Action Badge/Toast */}
			{currentAction && (
				<div className="absolute -top-12 left-1/2 -translate-x-1/2 z-20 animate-in fade-in slide-in-from-top-2 duration-300">
					<div className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm font-medium shadow-lg border border-primary/20">
						{isTyping ? (
							<>
								<Sparkles className="w-4 h-4 animate-pulse" />
								<span>{currentAction}</span>
							</>
						) : currentAction === "✓ Complete" ? (
							<>
								<CheckCircle className="w-4 h-4" />
								<span>{currentAction}</span>
							</>
						) : (
							<>
								<FileCode className="w-4 h-4" />
								<span>{currentAction}</span>
							</>
						)}
					</div>
				</div>
			)}

			{/* VSCode-like tabs */}
			<div
				ref={tabsContainerRef}
				className="flex items-center bg-card/30 border-b border-border overflow-x-auto scrollbar-hide"
			>
				{uniqueFiles.map((fileName) => {
					const isActive = fileName === currentFile;
					return (
						<button
							key={fileName}
							ref={isActive ? activeTabRef : null}
							type="button"
							onClick={() => handleTabClick(fileName)}
							className={cn(
								"flex items-center gap-2 px-4 py-2.5 text-sm font-mono border-r border-border transition-colors relative group min-w-fit",
								isActive
									? "bg-background text-foreground"
									: "bg-card/50 text-muted-foreground hover:bg-card hover:text-foreground",
							)}
						>
							{/* File icon based on extension */}
							<span
								className={cn(
									"w-2 h-2 rounded-full",
									fileName.endsWith(".ts")
										? "bg-blue-500"
										: fileName.endsWith(".tsx")
											? "bg-cyan-500"
											: "bg-gray-500",
								)}
							/>

							{/* Filename */}
							<span className="select-none">{fileName}</span>

							{/* Modified indicator (when typing) */}
							{isActive && isTyping && (
								<span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-pulse" />
							)}

							{/* Close button (hover only, non-functional) */}
							<X className="w-3 h-3 opacity-0 group-hover:opacity-50 transition-opacity" />

							{/* Active indicator */}
							{isActive && (
								<div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
							)}
						</button>
					);
				})}
			</div>

			{/* Code editor area */}
			<div
				ref={codeContainerRef}
				className="flex-1 bg-background p-6 overflow-auto font-mono text-sm scrollbar-hide"
			>
				{/* Light mode */}
				<div className="dark:hidden scrollbar-hide overflow-hidden">
					<SyntaxHighlighter
						language={activeStep?.language || "typescript"}
						style={coldarkCold}
						customStyle={{
							background: "transparent",
							padding: 0,
							margin: 0,
							fontSize: "0.875rem",
							overflow: "visible",
						}}
						showLineNumbers={true}
						wrapLines={true}
						lineNumberStyle={{ minWidth: "3em", paddingRight: "1em" }}
						codeTagProps={{ className: "scrollbar-hide" }}
						PreTag="div"
					>
						{displayedCode}
					</SyntaxHighlighter>
				</div>

				{/* Dark mode */}
				<div className="hidden dark:block scrollbar-hide overflow-hidden">
					<SyntaxHighlighter
						language={activeStep?.language || "typescript"}
						style={coldarkDark}
						customStyle={{
							background: "transparent",
							padding: 0,
							margin: 0,
							fontSize: "0.875rem",
							overflow: "visible",
						}}
						showLineNumbers={true}
						wrapLines={true}
						lineNumberStyle={{ minWidth: "3em", paddingRight: "1em" }}
						codeTagProps={{ className: "scrollbar-hide" }}
						PreTag="div"
					>
						{displayedCode}
					</SyntaxHighlighter>
				</div>
			</div>
		</div>
	);
}
