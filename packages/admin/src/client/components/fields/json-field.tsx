/**
 * JsonField Component
 *
 * JSON field with two editing modes:
 * - "code" - Raw JSON editing with syntax highlighting
 * - "form" - Structured form editing (if schema provided)
 *
 * Integrates with react-hook-form via Controller.
 */

import { Icon } from "@iconify/react";
import * as React from "react";
import { Controller, useFormContext } from "react-hook-form";
import { useResolveText } from "../../i18n/hooks";
import { cn } from "../../lib/utils";
import { Button } from "../ui/button";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "../ui/field";
import { Textarea } from "../ui/textarea";
import type { BaseFieldProps } from "./field-types";

export type JsonFieldMode = "code" | "form";

export type JsonFieldProps = BaseFieldProps & {
  /**
   * Is the field readonly
   */
  readOnly?: boolean;

  /**
   * Initial editing mode
   * @default "code"
   */
  defaultMode?: JsonFieldMode;

  /**
   * Allow switching between modes
   * @default true
   */
  allowModeSwitch?: boolean;

  /**
   * Minimum height for the editor
   * @default 200
   */
  minHeight?: number;

  /**
   * Maximum height for the editor (0 = no limit)
   * @default 400
   */
  maxHeight?: number;

  /**
   * Custom render function for form mode
   * Receives current value and onChange handler
   */
  renderForm?: (props: {
    value: any;
    onChange: (value: any) => void;
    disabled?: boolean;
    readOnly?: boolean;
  }) => React.ReactNode;
};

/**
 * JSON field with code editor and optional form mode.
 *
 * @example
 * ```tsx
 * // Basic JSON editor
 * <JsonField
 *   name="metadata"
 *   label="Metadata"
 *   description="Additional metadata as JSON"
 * />
 *
 * // With custom form mode
 * <JsonField
 *   name="settings"
 *   label="Settings"
 *   renderForm={({ value, onChange }) => (
 *     <SettingsForm value={value} onChange={onChange} />
 *   )}
 * />
 * ```
 */
export function JsonField({
  name,
  label,
  description,
  required,
  disabled,
  readOnly,
  placeholder = '{\n  "key": "value"\n}',
  defaultMode = "code",
  allowModeSwitch = true,
  minHeight = 200,
  maxHeight = 400,
  renderForm,
  control: controlProp,
  className,
}: JsonFieldProps) {
  const resolveText = useResolveText();
  const resolvedLabel = label ? resolveText(label) : undefined;
  const resolvedDescription = description
    ? resolveText(description)
    : undefined;
  const formContext = useFormContext();
  const control = controlProp ?? formContext?.control;
  const [mode, setMode] = React.useState<JsonFieldMode>(defaultMode);

  if (!control) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "JsonField: No form control found. Make sure to use within FormProvider or pass control prop.",
      );
    }
    return null;
  }

  // Only show mode switch if form rendering is available
  const showModeSwitch = allowModeSwitch && renderForm;

  return (
    <Controller
      name={name}
      control={control}
      rules={{
        required: required ? `${resolvedLabel || name} is required` : undefined,
        validate: (value) => {
          if (!value) return true;
          // In code mode, validate JSON
          if (mode === "code" && typeof value === "string") {
            try {
              JSON.parse(value);
              return true;
            } catch {
              return "Invalid JSON format";
            }
          }
          return true;
        },
      }}
      render={({ field, fieldState }) => {
        const error = fieldState.error?.message;

        return (
          <Field data-invalid={!!error} className={className}>
            {/* Header with label and mode switch */}
            <div className="flex items-center justify-between">
              {resolvedLabel && (
                <FieldLabel htmlFor={name}>
                  {resolvedLabel}
                  {required && <span className="text-destructive ml-1">*</span>}
                </FieldLabel>
              )}

              {showModeSwitch && (
                <div className="flex gap-1">
                  <Button
                    type="button"
                    variant={mode === "code" ? "secondary" : "ghost"}
                    size="icon-xs"
                    onClick={() => setMode("code")}
                    disabled={disabled}
                    title="Code editor"
                  >
                    <Icon icon="ph:code-bold" />
                  </Button>
                  <Button
                    type="button"
                    variant={mode === "form" ? "secondary" : "ghost"}
                    size="icon-xs"
                    onClick={() => setMode("form")}
                    disabled={disabled}
                    title="Form editor"
                  >
                    <Icon icon="ph:list-bullets-bold" />
                  </Button>
                </div>
              )}
            </div>

            <FieldContent>
              {mode === "code" ? (
                <JsonCodeEditor
                  value={field.value}
                  onChange={field.onChange}
                  disabled={disabled}
                  readOnly={readOnly}
                  placeholder={placeholder}
                  minHeight={minHeight}
                  maxHeight={maxHeight}
                  error={!!error}
                />
              ) : renderForm ? (
                <JsonFormEditor
                  value={field.value}
                  onChange={field.onChange}
                  disabled={disabled}
                  readOnly={readOnly}
                  renderForm={renderForm}
                />
              ) : (
                <JsonCodeEditor
                  value={field.value}
                  onChange={field.onChange}
                  disabled={disabled}
                  readOnly={readOnly}
                  placeholder={placeholder}
                  minHeight={minHeight}
                  maxHeight={maxHeight}
                  error={!!error}
                />
              )}

              {resolvedDescription && !error && (
                <FieldDescription>{resolvedDescription}</FieldDescription>
              )}
              <FieldError>{error}</FieldError>
            </FieldContent>
          </Field>
        );
      }}
    />
  );
}

/**
 * Code editor for JSON (using Textarea for simplicity)
 * Can be replaced with Monaco/CodeMirror in the future
 */
function JsonCodeEditor({
  value,
  onChange,
  disabled,
  readOnly,
  placeholder,
  minHeight,
  maxHeight,
  error,
}: {
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
  readOnly?: boolean;
  placeholder?: string;
  minHeight?: number;
  maxHeight?: number;
  error?: boolean;
}) {
  const [localValue, setLocalValue] = React.useState<string>(() => {
    if (typeof value === "string") return value;
    if (value === null || value === undefined) return "";
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return "";
    }
  });
  const [parseError, setParseError] = React.useState<string | null>(null);

  // Sync local value when external value changes
  React.useEffect(() => {
    if (typeof value === "string") {
      setLocalValue(value);
    } else if (value !== null && value !== undefined) {
      try {
        setLocalValue(JSON.stringify(value, null, 2));
      } catch {
        // Keep current local value if stringification fails
      }
    } else {
      setLocalValue("");
    }
  }, [value]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setLocalValue(newValue);

    // Try to parse and update form value
    if (!newValue.trim()) {
      setParseError(null);
      onChange(null);
      return;
    }

    try {
      const parsed = JSON.parse(newValue);
      setParseError(null);
      onChange(parsed);
    } catch (err) {
      setParseError("Invalid JSON");
      // Still update with raw string so validation can catch it
      onChange(newValue);
    }
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(localValue);
      const formatted = JSON.stringify(parsed, null, 2);
      setLocalValue(formatted);
      setParseError(null);
      onChange(parsed);
    } catch {
      // Can't format invalid JSON
    }
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Textarea
          value={localValue}
          onChange={handleChange}
          disabled={disabled}
          readOnly={readOnly}
          placeholder={placeholder}
          className={cn(
            "font-mono text-xs",
            error || parseError ? "border-destructive" : "",
          )}
          style={{
            minHeight: `${minHeight}px`,
            maxHeight: maxHeight ? `${maxHeight}px` : undefined,
            resize: maxHeight ? "none" : "vertical",
          }}
          aria-invalid={!!error || !!parseError}
        />

        {/* Parse error indicator */}
        {parseError && (
          <div className="text-destructive absolute right-2 top-2 flex items-center gap-1 text-xs">
            <Icon icon="ph:warning-circle-fill" className="size-3" />
            {parseError}
          </div>
        )}
      </div>

      {/* Format button */}
      {!readOnly && !disabled && localValue && (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="ghost"
            size="xs"
            onClick={handleFormat}
            disabled={!!parseError}
          >
            Format JSON
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * Form-based editor wrapper
 */
function JsonFormEditor({
  value,
  onChange,
  disabled,
  readOnly,
  renderForm,
}: {
  value: any;
  onChange: (value: any) => void;
  disabled?: boolean;
  readOnly?: boolean;
  renderForm: JsonFieldProps["renderForm"];
}) {
  // Ensure value is an object for form mode
  const safeValue = React.useMemo(() => {
    if (typeof value === "object" && value !== null) {
      return value;
    }
    if (typeof value === "string") {
      try {
        return JSON.parse(value);
      } catch {
        return {};
      }
    }
    return {};
  }, [value]);

  if (!renderForm) return null;

  return (
    <div className="rounded-lg border p-4">
      {renderForm({
        value: safeValue,
        onChange,
        disabled,
        readOnly,
      })}
    </div>
  );
}
