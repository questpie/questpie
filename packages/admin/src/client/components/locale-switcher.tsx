import { Icon } from "@iconify/react";
import type * as React from "react";
import { useMemo, useState } from "react";
import { useResolveText } from "../i18n/hooks";
import type { I18nText } from "../i18n/types";
import { cn } from "../lib/utils";
import { getFlagUrl } from "../utils/locale-to-flag";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";

export type LocaleOption = {
  code: string;
  label?: I18nText;
  flagCountryCode?: string;
};

export type LocaleSwitcherLabelMode = "code" | "name" | "both" | "none";

export interface LocaleSwitcherProps {
  locales: LocaleOption[];
  value?: string;
  onChange?: (locale: string) => void;
  showFlag?: boolean;
  labelMode?: LocaleSwitcherLabelMode;
  className?: string;
}

const DROPDOWN_THRESHOLD = 4;

export function LocaleSwitcher({
  locales,
  value,
  onChange,
  showFlag = true,
  labelMode = "code",
  className,
}: LocaleSwitcherProps): React.ReactElement | null {
  const resolveText = useResolveText();
  const [imgError, setImgError] = useState(false);
  const resolvedValue = value ?? locales[0]?.code ?? "";
  const hasResolvedValue = resolvedValue.length > 0;
  const localeOptions = locales.length
    ? locales
    : hasResolvedValue
      ? [{ code: resolvedValue } satisfies LocaleOption]
      : [];
  const currentLocale =
    localeOptions.find((locale) => locale.code === resolvedValue) ??
    ({ code: resolvedValue } satisfies LocaleOption);
  const canSwitch = !!onChange && localeOptions.length > 1;
  const useDropdown = localeOptions.length >= DROPDOWN_THRESHOLD;

  const flagMapping = useMemo(() => {
    const mapping: Record<string, string> = {};
    for (const locale of localeOptions) {
      if (locale.flagCountryCode) {
        mapping[locale.code.toLowerCase()] = locale.flagCountryCode;
      }
    }
    return mapping;
  }, [localeOptions]);
  const hasCustomMapping = Object.keys(flagMapping).length > 0;

  const getLocaleFlagUrl = (code: string, size = 24) =>
    getFlagUrl(code, size, hasCustomMapping ? flagMapping : undefined);

  if (!hasResolvedValue) return null;

  const codeLabel = currentLocale.code.toUpperCase();
  const nameLabel = currentLocale.label
    ? resolveText(currentLocale.label)
    : codeLabel;
  const renderLabel = () => {
    switch (labelMode) {
      case "none":
        return null;
      case "name":
        return <span className="font-medium">{nameLabel}</span>;
      case "both":
        return (
          <span className="flex items-center gap-1">
            <span className="uppercase tracking-wide">{codeLabel}</span>
            {currentLocale.label && (
              <span className="font-normal text-muted-foreground">
                {resolveText(currentLocale.label)}
              </span>
            )}
          </span>
        );
      case "code":
      default:
        return <span className="uppercase tracking-wide">{codeLabel}</span>;
    }
  };

  const baseClassName = cn(
    "inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground",
    className,
  );
  const interactiveClassName = cn(
    baseClassName,
    "cursor-pointer transition-colors hover:bg-muted/80 focus:outline-none focus:ring-1 focus:ring-ring",
  );
  const ariaLabel = `Switch locale (current: ${nameLabel})`;

  const content = (
    <>
      {showFlag && !imgError && (
        <img
          src={getLocaleFlagUrl(resolvedValue)}
          alt={resolvedValue}
          className="h-2.5 w-3.5 rounded-[1px] object-cover"
          onError={() => setImgError(true)}
        />
      )}
      {renderLabel()}
    </>
  );

  if (!canSwitch) {
    return <span className={baseClassName}>{content}</span>;
  }

  if (!useDropdown) {
    const handleCycle = (e: React.MouseEvent) => {
      e.stopPropagation();
      const currentIndex = localeOptions.findIndex(
        (locale) => locale.code === resolvedValue,
      );
      const nextIndex = (currentIndex + 1) % localeOptions.length;
      const nextLocale = localeOptions[nextIndex]?.code;
      if (nextLocale) onChange(nextLocale);
    };

    return (
      <button
        type="button"
        onClick={handleCycle}
        className={interactiveClassName}
        aria-label={ariaLabel}
        title={ariaLabel}
      >
        {content}
      </button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={interactiveClassName}
        aria-label={ariaLabel}
        title={ariaLabel}
        onClick={(e) => e.stopPropagation()}
      >
        {content}
        <Icon icon="ph:caret-down" className="size-2.5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-[140px]">
        {localeOptions.map((locale) => (
          <DropdownMenuItem
            key={locale.code}
            onClick={(e) => {
              e.stopPropagation();
              onChange(locale.code);
            }}
            className="gap-2 text-xs"
          >
            {showFlag && (
              <img
                src={getLocaleFlagUrl(locale.code)}
                alt={locale.code}
                className="h-2.5 w-3.5 rounded-[1px] object-cover"
                onError={(event) => {
                  event.currentTarget.style.display = "none";
                }}
              />
            )}
            <span className="uppercase font-medium">{locale.code}</span>
            {locale.label && (
              <span className="text-muted-foreground">
                {resolveText(locale.label)}
              </span>
            )}
            {locale.code === resolvedValue && (
              <Icon icon="ph:check" className="ml-auto size-3" />
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
