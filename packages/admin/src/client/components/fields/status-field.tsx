import * as React from "react";
import { Badge } from "../../components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { useResolveText } from "../../i18n/hooks";
import type { I18nText } from "../../i18n/types";
import { cn } from "../../lib/utils";

export interface StatusOption {
  label: I18nText;
  value: string;
  color?: "default" | "primary" | "secondary" | "destructive" | "outline";
}

export interface StatusFieldProps {
  value: string | boolean;
  onChange: (value: string | boolean) => void;
  options?: StatusOption[];
  type?: "switch" | "select" | "badge";
  disabled?: boolean;
  className?: string;
}

const defaultOptions: StatusOption[] = [
  { label: "Draft", value: "draft", color: "secondary" },
  { label: "Published", value: "published", color: "primary" },
  { label: "Archived", value: "archived", color: "destructive" },
];

export function StatusField({
  value,
  onChange,
  options = defaultOptions,
  type = "select",
  disabled,
  className,
}: StatusFieldProps) {
  const resolveText = useResolveText();
  // Binary Switch Mode
  if (type === "switch" || typeof value === "boolean") {
    return (
      <div className={cn("flex items-center gap-2", className)}>
        <Switch
          checked={value === true}
          onCheckedChange={onChange}
          disabled={disabled}
        />
        <span className="text-sm font-medium text-muted-foreground">
          {value ? "Active" : "Inactive"}
        </span>
      </div>
    );
  }

  // Select Mode
  if (type === "select") {
    return (
      <Select
        value={value ? String(value) : undefined}
        onValueChange={(val) => val && onChange(val)}
        disabled={disabled}
      >
        <SelectTrigger className={cn("w-[140px]", className)}>
          <SelectValue>
            {value ? undefined : (
              <span className="text-muted-foreground">Status</span>
            )}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option.value} value={option.value}>
              <div className="flex items-center gap-2">
                <div
                  className={cn(
                    "h-2 w-2 rounded-full",
                    option.color === "primary" && "bg-primary glow-primary-sm",
                    option.color === "destructive" &&
                      "bg-destructive glow-destructive",
                    (!option.color || option.color === "secondary") &&
                      "bg-muted-foreground",
                  )}
                />
                {resolveText(option.label)}
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  // Badge Mode (Read-onlyish or click to toggle if simple)
  const currentOption = options.find((o) => o.value === value) || options[0];
  return (
    <Badge
      variant={currentOption?.color as any}
      className={cn(
        "uppercase tracking-wider font-mono text-[10px]",
        className,
      )}
    >
      {currentOption?.label ? resolveText(currentOption.label) : value}
    </Badge>
  );
}
