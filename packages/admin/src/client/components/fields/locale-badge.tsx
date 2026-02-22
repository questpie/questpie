import * as React from "react";
import { Badge } from "../ui/badge";

type LocaleBadgeProps = {
	locale?: string;
};

export function LocaleBadge({ locale }: LocaleBadgeProps) {
	if (!locale) return null;
	return (
		<Badge variant="secondary" className="uppercase text-[10px] tracking-wide">
			{locale}
		</Badge>
	);
}
