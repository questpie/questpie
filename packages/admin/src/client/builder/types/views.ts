import type * as React from "react";

import type { ListViewConfig } from "./collection-types";
import type { ComponentRegistry, FormViewConfig } from "./field-types";

type ViewBaseProps = {
	navigate: (path: string) => void;
	basePath?: string;
	config?: Record<string, any>;
	viewConfig?: ListViewConfig | FormViewConfig;
	registry?: ComponentRegistry;
};

export interface CollectionListViewProps {
	collection: string;
	baseFindOptions?: any;
	realtime?: boolean;
	headerActions?: React.ReactNode;
	onRowClick?: (item: any) => void;
	config?: ViewBaseProps["config"];
	viewConfig?: ListViewConfig;
	navigate: ViewBaseProps["navigate"];
	basePath?: ViewBaseProps["basePath"];
}

export interface CollectionFormViewProps {
	collection: string;
	id?: string;
	title?: string;
	headerActions?: React.ReactNode;
	onSuccess?: (data?: any) => void;
	onCancel?: () => void;
	onError?: (error: Error) => void;
	defaultValues?: Record<string, any>;
	allCollectionsConfig?: Record<string, any>;
	config?: ViewBaseProps["config"];
	viewConfig?: FormViewConfig;
	navigate: ViewBaseProps["navigate"];
	basePath?: ViewBaseProps["basePath"];
	registry?: ViewBaseProps["registry"];
	children?: React.ReactNode;
}

export interface GlobalFormViewProps {
	global: string;
	title?: string;
	description?: string;
	headerActions?: React.ReactNode;
	onSuccess?: (data?: any) => void;
	onError?: (error: Error) => void;
	allGlobalsConfig?: Record<string, any>;
	config?: ViewBaseProps["config"];
	viewConfig?: FormViewConfig;
	navigate: ViewBaseProps["navigate"];
	basePath?: ViewBaseProps["basePath"];
	registry?: ViewBaseProps["registry"];
	children?: React.ReactNode;
}

export interface DefaultViewsConfig {
	dashboard?: {
		component?: React.ComponentType;
		header?: {
			title?: string;
			showDate?: boolean;
		};
		welcomeCard?: {
			title?: string;
			description?: string;
		};
	};

	collectionList?: {
		component?: React.ComponentType<CollectionListViewProps>;
		showSearch?: boolean;
		showFilters?: boolean;
		showToolbar?: boolean;
		realtime?: boolean;
		emptyState?: React.ComponentType;
	};

	collectionForm?: {
		component?: React.ComponentType<CollectionFormViewProps>;
		showMeta?: boolean;
		showStatus?: boolean;
		sidebarFields?: string[];
	};

	globalForm?: {
		component?: React.ComponentType<GlobalFormViewProps>;
		layout?: "single" | "sidebar";
	};
}
