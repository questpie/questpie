import * as React from "react";

export type Doc = Record<string, any>;

export function docsFromResult(result: unknown): Doc[] {
	if (Array.isArray(result)) return result as Doc[];
	if (
		result &&
		typeof result === "object" &&
		Array.isArray((result as any).docs)
	) {
		return (result as any).docs as Doc[];
	}
	return [];
}

export function itemTitle(doc: Doc | null | undefined, fallback: string) {
	const title =
		doc?.title ?? doc?.name ?? doc?.filename ?? doc?.path ?? doc?.id;
	return typeof title === "string" && title.trim() ? title : fallback;
}

export function relationId(value: unknown): string | null {
	if (!value) return null;
	if (typeof value === "string") return value;
	if (typeof value === "object" && "id" in value) return String(value.id);
	return null;
}

export function relationTitle(value: unknown, fallback = "None") {
	if (!value) return fallback;
	if (typeof value === "string") return value;
	if (typeof value === "object") {
		const doc = value as Doc;
		return itemTitle(doc, fallback);
	}
	return fallback;
}

export function formatDateTime(value: unknown) {
	if (!value) return "";
	const date = new Date(String(value));
	if (Number.isNaN(date.getTime())) return "";
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	}).format(date);
}

export function statusTone(status: unknown) {
	switch (status) {
		case "urgent":
		case "failed":
		case "cancelled":
			return "bg-destructive";
		case "high":
		case "review":
		case "waiting":
			return "bg-warning";
		case "completed":
		case "approved":
		case "done":
			return "bg-success";
		case "running":
		case "claimed":
			return "bg-info";
		case "pending":
		case "medium":
			return "bg-primary";
		default:
			return "bg-muted-foreground";
	}
}

export function useCollectionRealtime(
	client: unknown,
	collection: string,
	onChange: () => void,
	where?: Record<string, unknown>,
	subscriptionKey = "autopilot-admin",
) {
	React.useEffect(() => {
		const realtime = (client as any)?.realtime;
		if (!realtime?.subscribe) return;

		return realtime.subscribe(
			{
				resourceType: "collection",
				resource: collection,
				...(where ? { where } : {}),
			},
			onChange,
			undefined,
			`${subscriptionKey}:${collection}:${JSON.stringify(where ?? {})}`,
		);
	}, [client, collection, onChange, subscriptionKey, where]);
}
