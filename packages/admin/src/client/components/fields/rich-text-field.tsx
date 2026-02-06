import { Controller } from "react-hook-form";
import { useResolvedControl } from "./field-utils";
import type { RichTextEditorProps } from "./rich-text-editor";
import { RichTextEditor } from "./rich-text-editor";

export function RichTextField({
  name,
  control,
  onChange,
  ...props
}: RichTextEditorProps) {
  const resolvedControl = useResolvedControl(control);

  return (
    <Controller
      name={name}
      control={resolvedControl}
      render={({ field, fieldState }) => (
        <RichTextEditor
          {...props}
          name={name}
          value={field.value}
          onChange={(value) => {
            field.onChange(value);
            onChange?.(value);
          }}
          error={fieldState.error?.message}
        />
      )}
    />
  );
}
