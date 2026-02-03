import type {
	BlockSchema,
	ServerDashboardConfig,
	ServerSidebarConfig,
} from "#questpie/admin/server";
import type { I18nText } from "../i18n/types";

export type AdminConfigItemMeta = {
	label?: I18nText;
	description?: I18nText;
	icon?: { type: string; props: Record<string, unknown> };
	hidden?: boolean;
	group?: string;
	order?: number;
};

export type AdminConfigResponse = {
	dashboard?: ServerDashboardConfig;
	sidebar?: ServerSidebarConfig;
	blocks?: Record<string, BlockSchema>;
	collections?: Record<string, AdminConfigItemMeta>;
	globals?: Record<string, AdminConfigItemMeta>;
};
