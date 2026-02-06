import type * as React from "react";

export interface CollectionListViewProps {
  collection: string;
  baseFindOptions?: any;
  realtime?: boolean;
  headerActions?: React.ReactNode;
  onRowClick?: (item: any) => void;
}

export interface CollectionFormViewProps {
  collection: string;
  id?: string;
  title?: string;
  headerActions?: React.ReactNode;
  onSuccess?: () => void;
  onCancel?: () => void;
  children?: React.ReactNode;
}

export interface GlobalFormViewProps {
  global: string;
  title?: string;
  description?: string;
  headerActions?: React.ReactNode;
  onSuccess?: () => void;
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
