// Re-export all shadcn UI components

// View components - re-export from new views directory
// @deprecated Import from '@questpie/admin/views' instead
export * from "../views";
// Action components
export * from "./actions";
export type { AdminLinkProps } from "./admin-link";
// Navigation components
export {
  AdminLink,
  CollectionCreateLink,
  CollectionEditLink,
  CollectionLink,
  DashboardLink,
  GlobalLink,
} from "./admin-link";
// Auth components
export * from "./auth";

// Field components (RelationSelect, RelationPicker, etc.)
export * from "./fields";
// Filter builder components
export * from "./filter-builder";
// Locale switcher (agnostic)
export type {
  LocaleOption,
  LocaleSwitcherLabelMode,
  LocaleSwitcherProps,
} from "./locale-switcher";
export { LocaleSwitcher } from "./locale-switcher";
// Sheet components
export * from "./sheets";
// UI components (only export existing ones)
export * from "./ui/accordion";
export * from "./ui/avatar";
export * from "./ui/badge";
export * from "./ui/button";
export * from "./ui/card";
export * from "./ui/checkbox";
export * from "./ui/combobox";
export * from "./ui/dialog";
export * from "./ui/dropdown-menu";
export * from "./ui/field";
export * from "./ui/input";
export * from "./ui/input-group";
export * from "./ui/label";
export * from "./ui/popover";
export * from "./ui/scroll-area";
export * from "./ui/select";
export * from "./ui/separator";
export * from "./ui/sheet";
export * from "./ui/sidebar";
export * from "./ui/skeleton";
export * from "./ui/spinner";
export * from "./ui/switch";
export * from "./ui/table";
export * from "./ui/tabs";
export * from "./ui/textarea";
export * from "./ui/tooltip";
