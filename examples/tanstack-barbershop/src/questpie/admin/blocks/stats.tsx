/**
 * Stats Block
 *
 * Display key metrics/statistics in a grid.
 * Design: Clean cards with large numbers and labels.
 */

import { cn } from "../../../lib/utils";
import type { BlockProps } from "../.generated/client";

export function StatsRenderer({ values }: BlockProps<"stats">) {
	const columnsClass = {
		"2": "md:grid-cols-2",
		"3": "md:grid-cols-3",
		"4": "md:grid-cols-2 lg:grid-cols-4",
	}[values.columns || "3"];

	return (
		<section className="px-6 py-16">
			<div className="mx-auto max-w-6xl">
				{values.title && (
					<h2 className="mb-12 text-center text-3xl font-bold tracking-tight">
						{values.title}
					</h2>
				)}
				<div className={cn("grid grid-cols-1 gap-6", columnsClass)}>
					{values.stats?.map((stat, index) => (
						<div
							key={index}
							className="bg-card rounded-lg border p-6 text-center"
						>
							<div className="text-foreground mb-2 text-4xl font-bold">
								{stat.value}
							</div>
							<div className="text-foreground mb-1 text-lg font-medium">
								{stat.label}
							</div>
							{stat.description && (
								<div className="text-muted-foreground text-sm">
									{stat.description}
								</div>
							)}
						</div>
					))}
				</div>
			</div>
		</section>
	);
}
