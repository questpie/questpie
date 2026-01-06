export function Logo({ className }: { className?: string }) {
	return (
		<div className={className}>
			<img
				src="/logo/Questpie-dark-pink.svg"
				alt="QUESTPIE CMS"
				className="h-6 w-auto dark:hidden"
			/>
			<img
				src="/logo/Questpie-white-pink.svg"
				alt="QUESTPIE CMS"
				className="h-6 w-auto hidden dark:block"
			/>
		</div>
	);
}
