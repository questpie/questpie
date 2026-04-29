export function Logo({ className }: { className?: string }) {
	return (
		<div className={className}>
			<img
				src="/logo/horizontal-lockup-light.svg"
				alt="QUESTPIE"
				className="h-6 w-auto dark:hidden"
			/>
			<img
				src="/logo/horizontal-lockup-dark.svg"
				alt="QUESTPIE"
				className="hidden h-6 w-auto dark:block"
			/>
		</div>
	);
}
