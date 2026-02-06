/**
 * VersionHistory Component
 *
 * Displays version history and audit log for a collection item
 * - Shows all versions with timestamps
 * - Displays who made changes
 * - Allows comparing versions
 * - Shows diff between versions
 * - Ability to restore previous versions
 */

import { Icon } from "@iconify/react";
import { useQuery } from "@tanstack/react-query";
import type { Questpie } from "questpie";
import * as React from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../../components/ui/card";
import { Separator } from "../../components/ui/separator";
import { Spinner } from "../../components/ui/spinner";
import { useResolveText } from "../../i18n/hooks";
import { selectClient, useAdminStore, useScopedLocale } from "../../runtime";

export interface VersionHistoryProps<T extends Questpie<any>> {
  /**
   * Collection name
   */
  collection: string;

  /**
   * Item ID
   */
  itemId: string;

  /**
   * Show restore buttons
   */
  allowRestore?: boolean;

  /**
   * Callback when version is restored
   */
  onRestore?: (versionId: string) => void;

  /**
   * Custom render for version data
   */
  renderVersion?: (version: any) => React.ReactNode;

  /**
   * Show full diff or summary
   */
  showFullDiff?: boolean;
}

interface Version {
  id: string;
  versionNumber: number;
  createdAt: string;
  createdBy?: {
    id: string;
    name?: string;
    email?: string;
  };
  changes?: {
    field: string;
    oldValue: any;
    newValue: any;
  }[];
  action: "created" | "updated" | "deleted" | "restored";
  data: Record<string, any>;
}

export function VersionHistory<T extends Questpie<any>>({
  collection,
  itemId,
  allowRestore = false,
  onRestore,
  renderVersion,
  showFullDiff = false,
}: VersionHistoryProps<T>) {
  const client = useAdminStore(selectClient);
  // Use scoped locale (from LocaleScopeProvider in ResourceSheet) or global locale
  const { locale } = useScopedLocale();
  const localeKey = locale ?? "default";
  const resolveText = useResolveText();
  const [expandedVersions, setExpandedVersions] = React.useState<Set<string>>(
    new Set(),
  );

  // Fetch version history
  const {
    data: versions,
    isLoading,
    error,
  } = useQuery({
    queryKey: ["version-history", collection, itemId, localeKey],
    queryFn: async () => {
      // TODO: Implement actual version history endpoint
      // For now, return mock data structure
      // const result = await client.collections[collection].getVersionHistory(itemId);
      // return result;

      // Mock data for demonstration
      return [
        {
          id: "v3",
          versionNumber: 3,
          createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
          createdBy: {
            id: "user1",
            name: "John Doe",
            email: "john@example.com",
          },
          action: "updated",
          changes: [
            { field: "status", oldValue: "pending", newValue: "confirmed" },
          ],
          data: {},
        },
        {
          id: "v2",
          versionNumber: 2,
          createdAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          createdBy: {
            id: "user2",
            name: "Jane Smith",
            email: "jane@example.com",
          },
          action: "updated",
          changes: [
            {
              field: "scheduledAt",
              oldValue: "2025-01-15T10:00:00",
              newValue: "2025-01-20T14:00:00",
            },
          ],
          data: {},
        },
        {
          id: "v1",
          versionNumber: 1,
          createdAt: new Date(
            Date.now() - 7 * 24 * 60 * 60 * 1000,
          ).toISOString(),
          createdBy: {
            id: "user1",
            name: "John Doe",
            email: "john@example.com",
          },
          action: "created",
          changes: [],
          data: {},
        },
      ] as Version[];
    },
  });

  const toggleVersion = (versionId: string) => {
    setExpandedVersions((prev) => {
      const next = new Set(prev);
      if (next.has(versionId)) {
        next.delete(versionId);
      } else {
        next.add(versionId);
      }
      return next;
    });
  };

  const handleRestore = (versionId: string) => {
    onRestore?.(versionId);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60)
      return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24)
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
    return date.toLocaleDateString();
  };

  const getActionBadge = (action: Version["action"]) => {
    const variants: Record<Version["action"], { variant: any; label: string }> =
      {
        created: { variant: "default", label: "Created" },
        updated: { variant: "secondary", label: "Updated" },
        deleted: { variant: "destructive", label: "Deleted" },
        restored: { variant: "outline", label: "Restored" },
      };

    const config = variants[action];
    return <Badge variant={config.variant}>{resolveText(config.label)}</Badge>;
  };

  const formatValue = (value: any): string => {
    if (value === null || value === undefined) return "—";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon icon="ph:clock-counter-clockwise" className="h-5 w-5" />
            Version History
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center p-8">
          <Spinner className="h-6 w-6" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon icon="ph:clock-counter-clockwise" className="h-5 w-5" />
            Version History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-destructive">
            Failed to load version history:{" "}
            {error instanceof Error ? error.message : "Unknown error"}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (!versions || versions.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Icon icon="ph:clock-counter-clockwise" className="h-5 w-5" />
            Version History
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No version history available
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Icon icon="ph:clock-counter-clockwise" className="h-5 w-5" />
          Version History
        </CardTitle>
        <CardDescription>
          {versions.length} version{versions.length !== 1 ? "s" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {versions.map((version, index) => {
          const isExpanded = expandedVersions.has(version.id);
          const isLatest = index === 0;

          return (
            <div key={version.id}>
              {index > 0 && <Separator className="my-4" />}

              <div className="space-y-2">
                <div className="flex items-start gap-3">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6 shrink-0"
                    onClick={() => toggleVersion(version.id)}
                  >
                    {isExpanded ? (
                      <Icon icon="ph:caret-down" className="h-4 w-4" />
                    ) : (
                      <Icon icon="ph:caret-right" className="h-4 w-4" />
                    )}
                  </Button>

                  <div className="flex-1 space-y-1">
                    {/* Version Header */}
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">
                        Version {version.versionNumber}
                      </span>
                      {getActionBadge(version.action)}
                      {isLatest && <Badge variant="outline">Current</Badge>}
                    </div>

                    {/* Metadata */}
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <div className="flex items-center gap-1">
                        <Icon icon="ph:clock" className="h-3 w-3" />
                        {formatDate(version.createdAt)}
                      </div>
                      {version.createdBy && (
                        <div className="flex items-center gap-1">
                          <Icon icon="ph:user" className="h-3 w-3" />
                          {version.createdBy.name || version.createdBy.email}
                        </div>
                      )}
                    </div>

                    {/* Changes Summary */}
                    {version.changes &&
                      version.changes.length > 0 &&
                      !isExpanded && (
                        <p className="text-xs text-muted-foreground">
                          {version.changes.length} field
                          {version.changes.length !== 1 ? "s" : ""} changed
                        </p>
                      )}

                    {/* Expanded Changes */}
                    {isExpanded && (
                      <div className="mt-3 space-y-2">
                        {version.changes && version.changes.length > 0 ? (
                          <div className="border bg-muted/50 p-3 space-y-2">
                            {version.changes.map((change, changeIndex) => (
                              <div key={changeIndex} className="text-xs">
                                <div className="font-medium text-foreground mb-1">
                                  {change.field}
                                </div>
                                <div className="grid grid-cols-2 gap-2">
                                  <div>
                                    <div className="text-muted-foreground">
                                      Old value:
                                    </div>
                                    <div className="font-mono rounded bg-background p-1 mt-1">
                                      {formatValue(change.oldValue)}
                                    </div>
                                  </div>
                                  <div>
                                    <div className="text-muted-foreground">
                                      New value:
                                    </div>
                                    <div className="font-mono rounded bg-background p-1 mt-1">
                                      {formatValue(change.newValue)}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            No changes recorded
                          </p>
                        )}

                        {/* Custom Version Render */}
                        {renderVersion && renderVersion(version)}

                        {/* Restore Button */}
                        {allowRestore && !isLatest && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleRestore(version.id)}
                            className="mt-2"
                          >
                            <Icon
                              icon="ph:arrow-counter-clockwise"
                              className="mr-2 h-3 w-3"
                            />
                            Restore this version
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
