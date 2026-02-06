/**
 * Field components for admin forms
 *
 * All field components are integrated with react-hook-form via Controller.
 * They use the primitive components from ../primitives for the actual UI.
 */

export type { ArrayFieldItemType, ArrayFieldProps } from "./array-field";
export { ArrayField } from "./array-field";
export type { AssetPreviewFieldProps } from "./asset-preview-field";
// Asset preview field (read-only)
export { AssetPreviewField } from "./asset-preview-field";
export type { BlocksFieldConfig, BlocksFieldProps } from "./blocks-field";
export { BlocksField } from "./blocks-field";
// Boolean field (unified checkbox/switch)
export type { BooleanFieldProps } from "./boolean-field";
export { BooleanField, CheckboxField, SwitchField } from "./boolean-field";
export { CustomField } from "./custom-field";
export { DateField } from "./date-field";
export { DatetimeField } from "./datetime-field";
export { EmailField } from "./email-field";
export type { EmbeddedCollectionFieldProps } from "./embedded-collection";

export { EmbeddedCollectionField } from "./embedded-collection";
// Types (note: RelationDisplayMode and RelationDisplayFields are exported from ./relation above)
// BooleanFieldProps is now exported from ./boolean-field above
export type {
  ArrayFieldConfig,
  ArrayItemType,
  BaseFieldProps,
  CheckboxGroupFieldProps,
  DateFieldProps,
  DateRangeFieldProps,
  DateTimeFieldProps,
  EmbeddedFieldConfig,
  FormFieldProps,
  FormFieldType,
  NumberFieldProps,
  ObjectFieldConfig,
  ObjectFieldLayout,
  RadioGroupFieldProps,
  RelationFieldConfig,
  ReverseRelationFieldConfig,
  RichTextFieldConfig,
  SelectFieldProps,
  SelectOption,
  SelectOptionGroup,
  TagsFieldProps,
  TextareaFieldProps,
  TextFieldProps,
  TimeFieldConfig,
  TimeFieldProps,
  UploadFieldConfig,

  // Note: RichTextFeatures is exported from ./rich-text-editor
} from "./field-types";
export { useResolvedControl } from "./field-utils";
export { FieldWrapper } from "./field-wrapper";
export type { JsonFieldMode, JsonFieldProps } from "./json-field";
export { JsonField } from "./json-field";
// Utilities
export { LocaleBadge } from "./locale-badge";
export { NumberField } from "./number-field";
export type { ObjectArrayFieldProps } from "./object-array-field";
export { ObjectArrayField } from "./object-array-field";
export type { ObjectFieldProps } from "./object-field";
export { ObjectField } from "./object-field";

// Relation display components (shared between relation fields)
export {
  type RelationDisplayFields,
  type RelationDisplayMode,
  type RelationDisplayProps,
  type RelationItemActions,
  RelationItemsDisplay,
} from "./relation";
export type { RelationFieldProps } from "./relation-field";
export { RelationField } from "./relation-field";
export type { RelationPickerProps } from "./relation-picker";
export { RelationPicker } from "./relation-picker";
export type { RelationSelectProps } from "./relation-select";
// Complex field components
export { RelationSelect } from "./relation-select";
export type { ReverseRelationFieldProps } from "./reverse-relation-field";
export { ReverseRelationField } from "./reverse-relation-field";
export type { RichTextEditorProps, RichTextFeatures } from "./rich-text-editor";
export { RichTextEditor } from "./rich-text-editor";
export { RichTextField } from "./rich-text-field";
export { SelectField } from "./select-field";
export type { StatusFieldProps, StatusOption } from "./status-field";
export { StatusField } from "./status-field";
// SwitchField is now exported from boolean-field.tsx above
// Basic field components (using primitives)
export { TextField } from "./text-field";
export { TextareaField } from "./textarea-field";
export { TimeField } from "./time-field";
export type { UploadFieldProps } from "./upload-field";
// Upload field components
export { UploadField } from "./upload-field";
