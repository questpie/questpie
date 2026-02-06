/**
 * Business Hours Block
 *
 * Displays shop opening hours in a clean table format.
 * Design: Simple, scannable layout with day/hours pairs.
 */

import type {
  BlockDefinition,
  BlockRendererProps,
} from "@questpie/admin/client";
import { cn } from "../../../lib/utils";

type HoursValues = {
  title?: string;
  showClosed: boolean;
};

type HoursPrefetchedData = {
  businessHours?: {
    monday?: { isOpen: boolean; start: string; end: string };
    tuesday?: { isOpen: boolean; start: string; end: string };
    wednesday?: { isOpen: boolean; start: string; end: string };
    thursday?: { isOpen: boolean; start: string; end: string };
    friday?: { isOpen: boolean; start: string; end: string };
    saturday?: { isOpen: boolean; start: string; end: string };
    sunday?: { isOpen: boolean; start: string; end: string };
  };
};

function HoursRenderer({ values, data }: BlockRendererProps<HoursValues>) {
  const hoursData = (data as HoursPrefetchedData) || {};
  const businessHours = hoursData?.businessHours;

  const days = [
    { key: "monday", label: "Monday" },
    { key: "tuesday", label: "Tuesday" },
    { key: "wednesday", label: "Wednesday" },
    { key: "thursday", label: "Thursday" },
    { key: "friday", label: "Friday" },
    { key: "saturday", label: "Saturday" },
    { key: "sunday", label: "Sunday" },
  ] as const;

  return (
    <section className="px-6 py-16">
      <div className="mx-auto max-w-2xl">
        {values.title && (
          <h2 className="mb-8 text-3xl font-bold tracking-tight text-center">
            {values.title}
          </h2>
        )}
        <div className="rounded-lg border bg-card p-6">
          <dl className="space-y-3">
            {days.map(({ key, label }) => {
              const hours = businessHours?.[key];
              const isOpen = hours?.isOpen ?? false;
              const shouldShow = values.showClosed || isOpen;

              if (!shouldShow) return null;

              return (
                <div
                  key={key}
                  className="flex items-center justify-between py-2 border-b last:border-b-0"
                >
                  <dt className="font-medium text-foreground">{label}</dt>
                  <dd
                    className={cn(
                      "text-sm",
                      isOpen
                        ? "text-muted-foreground"
                        : "text-muted-foreground/60",
                    )}
                  >
                    {isOpen && hours
                      ? `${hours.start} - ${hours.end}`
                      : "Closed"}
                  </dd>
                </div>
              );
            })}
          </dl>
        </div>
      </div>
    </section>
  );
}

export const hoursBlock = {
  name: "hours",
  renderer: HoursRenderer,
} satisfies BlockDefinition;
