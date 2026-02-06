/**
 * Collection views - CRUD for CMS collections
 */

export type { AutoFormFieldsProps } from "./auto-form-fields";
export { AutoFormFields } from "./auto-form-fields";
export type { AssetThumbnailProps, RelationChipProps } from "./cells";
// Cell components
// Shared components (public API)
export {
  ArrayCell,
  AssetThumbnail,
  BooleanCell,
  DateCell,
  DateTimeCell,
  DefaultCell,
  EmailCell,
  JsonCell,
  NumberCell,
  ObjectCell,
  RelationCell,
  RelationChip,
  ReverseRelationCell,
  RichTextCell,
  SelectCell,
  TextCell,
  TimeCell,
  UploadCell,
  UploadManyCell,
} from "./cells";
// Column building
export type {
  BuildColumnsOptions,
  CollectionMeta,
  ColumnField,
  ComputeDefaultColumnsOptions,
} from "./columns";
export {
  buildColumns,
  computeDefaultColumns,
  getAllAvailableFields,
  SYSTEM_FIELDS,
} from "./columns";

export type { FormFieldProps } from "./form-field";
export { FormField } from "./form-field";
export {
  default as FormView,
  type FormViewProps,
  type FormViewRegistryConfig,
} from "./form-view";
// View registry components
export {
  default as TableView,
  type TableViewConfig,
  type TableViewProps,
} from "./table-view";
