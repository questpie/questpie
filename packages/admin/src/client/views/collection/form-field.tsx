import type * as React from "react";
import { BooleanField } from "../../components/fields/boolean-field";
import { CustomField } from "../../components/fields/custom-field";
import { DateField } from "../../components/fields/date-field";
import { DatetimeField } from "../../components/fields/datetime-field";
import { EmailField } from "../../components/fields/email-field";
import type { FormFieldProps } from "../../components/fields/field-types";
import { JsonField } from "../../components/fields/json-field";
import { NumberField } from "../../components/fields/number-field";
import { SelectField } from "../../components/fields/select-field";
import { TextField } from "../../components/fields/text-field";
import { TextareaField } from "../../components/fields/textarea-field";

export type { FormFieldProps } from "../../components/fields/field-types";

/**
 * FormField - Generic form field with React Hook Form integration
 */
export function FormField({
  type = "text",
  component,
  options,
  ...baseProps
}: FormFieldProps): React.ReactElement {
  if (component) {
    return <CustomField {...baseProps} component={component} />;
  }

  switch (type) {
    case "textarea":
      return <TextareaField {...baseProps} />;
    case "checkbox":
      return <BooleanField {...baseProps} displayAs="checkbox" />;
    case "switch":
      return <BooleanField {...baseProps} displayAs="switch" />;
    case "select":
      return <SelectField {...baseProps} options={options} />;
    case "number":
      return <NumberField {...baseProps} />;
    case "date":
      return <DateField {...baseProps} />;
    case "datetime":
      return <DatetimeField {...baseProps} />;
    case "email":
      return <EmailField {...baseProps} />;
    case "password":
      return <TextField {...baseProps} type="password" />;
    case "json":
      return <JsonField {...baseProps} />;
    default:
      return <TextField {...baseProps} />;
  }
}
