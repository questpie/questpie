import type {
	ServerAdminShellConfig,
	ServerDashboardConfig,
	ServerSidebarConfig,
} from "../../server/augmentation/index.js";
import type { BlockSchema } from "../../server/modules/admin/block/index.js";
import type { I18nText } from "../i18n/types";

export type AdminConfigItemMeta = {
	label?: I18nText;
	description?: I18nText;
	icon?: { type: string; props: Record<string, unknown> };
	hidden?: boolean;
	group?: string;
	order?: number;
};

export type BrandLogoConfig =
	| string
	| {
			src: string;
			srcDark?: string;
			alt?: string;
			width?: number;
			height?: number;
	  }
	| { type: string; props?: Record<string, unknown> };

export type BrandingConfig = {
	name?: I18nText;
	logo?: BrandLogoConfig;
	tagline?: I18nText;
	favicon?: string;
};

export type AdminConfigResponse = {
	dashboard?: ServerDashboardConfig;
	sidebar?: ServerSidebarConfig;
	shell?: ServerAdminShellConfig;
	branding?: BrandingConfig;
	blocks?: Record<string, BlockSchema>;
	collections?: Record<string, AdminConfigItemMeta>;
	globals?: Record<string, AdminConfigItemMeta>;
	uploads?: {
		collections: string[];
		defaultCollection?: string;
	};
};
