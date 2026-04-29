/**
 * Business Hours Block
 *
 * Displays shop opening hours in a clean table format.
 * Design: Simple, scannable layout with day/hours pairs.
 */

import { useTranslation } from "../../../lib/providers/locale-provider";
import { cn } from "../../../lib/utils";
import type { BlockProps } from "../.generated/client";

type BusinessHoursDay = { isOpen: boolean; start: string; end: string };
type BusinessHours = Record<string, BusinessHoursDay | undefined>;

export function HoursRenderer({ values, data }: BlockProps<"hours">) {
	const { t } = useTranslation();
	const businessHours = data?.businessHours as BusinessHours | undefined;

	const days = [
		{ key: "monday", labelKey: "day.monday" },
		{ key: "tuesday", labelKey: "day.tuesday" },
		{ key: "wednesday", labelKey: "day.wednesday" },
		{ key: "thursday", labelKey: "day.thursday" },
		{ key: "friday", labelKey: "day.friday" },
		{ key: "saturday", labelKey: "day.saturday" },
		{ key: "sunday", labelKey: "day.sunday" },
	] as const;

	return (
		<section className="px-6 py-16">
			<div className="mx-auto max-w-2xl">
				{values.title && (
					<h2 className="mb-8 text-center text-3xl font-bold tracking-tight">
						{values.title}
					</h2>
				)}
				<div className="bg-card rounded-lg border p-6">
					<dl className="space-y-3">
						{days.map(({ key, labelKey }) => {
							const hours = businessHours?.[key];
							const isOpen = hours?.isOpen ?? false;
							const shouldShow = values.showClosed || isOpen;

							if (!shouldShow) return null;

							return (
								<div
									key={key}
									className="flex items-center justify-between border-b py-2 last:border-b-0"
								>
									<dt className="text-foreground font-medium">{t(labelKey)}</dt>
									<dd
										className={cn(
											"text-sm",
											isOpen
												? "text-muted-foreground"
												: "text-muted-foreground/60",
										)}
									>
										{isOpen && hours
											? `${hours.start} - ${hours.end}`
											: t("blocks.hours.closed")}
									</dd>
								</div>
							);
						})}
					</dl>
				</div>
			</div>
		</section>
	);
}
