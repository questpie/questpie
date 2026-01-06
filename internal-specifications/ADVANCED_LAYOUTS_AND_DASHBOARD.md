# Advanced Layouts & Dashboard System

## Overview

Specification for advanced form layouts, custom pages, and comprehensive dashboard system for @questpie/admin.

---

## 1. Advanced Form Layouts

### 1.1 Multi-Column Layouts

**Simple columns:**
```typescript
edit: {
  sections: [
    {
      title: "Basic Information",
      layout: "columns",
      columns: 2, // Split fields into 2 columns
      fields: ["firstName", "lastName", "email", "phone"]
      // Results in:
      // [firstName] [lastName]
      // [email]     [phone]
    }
  ]
}
```

**Responsive columns:**
```typescript
edit: {
  sections: [
    {
      title: "Contact Details",
      layout: "columns",
      columns: 3,
      grid: {
        columns: 3,
        gap: 4,
        responsive: {
          sm: 1, // 1 column on mobile
          md: 2, // 2 columns on tablet
          lg: 3  // 3 columns on desktop
        }
      },
      fields: ["email", "phone", "mobile", "fax", "address", "city"]
    }
  ]
}
```

### 1.2 Grid Layouts with Span

**Advanced grid with custom spans:**
```typescript
edit: {
  sections: [
    {
      title: "Product Details",
      layout: "grid",
      grid: {
        columns: 4,
        gap: 4
      },
      fields: [
        { field: "title", span: 4 },         // Full width
        { field: "description", span: 4 },   // Full width
        { field: "price", span: 1 },         // 1/4 width
        { field: "currency", span: 1 },      // 1/4 width
        { field: "stock", span: 1 },         // 1/4 width
        { field: "sku", span: 1 },           // 1/4 width
        { field: "category", span: 2 },      // 1/2 width
        { field: "tags", span: 2 },          // 1/2 width
      ]
    }
  ]
}
```

**String spans:**
```typescript
fields: [
  { field: "title", span: "full" },      // Full width
  { field: "firstName", span: "1/2" },   // Half width
  { field: "lastName", span: "1/2" },    // Half width
  { field: "address", span: "2/3" },     // Two thirds
  { field: "zipCode", span: "1/3" },     // One third
]
```

### 1.3 Inline Layouts

**Horizontal inline fields:**
```typescript
edit: {
  sections: [
    {
      title: "Date Range",
      layout: "inline",
      fields: ["startDate", "endDate"],
      // Results in: [Start Date] [End Date] on same line
    }
  ]
}
```

### 1.4 Conditional Sections

**Entire sections based on form values:**
```typescript
edit: {
  sections: [
    {
      title: "Basic Info",
      fields: ["name", "status"]
    },
    {
      title: "Cancellation Details",
      // Only show this section when status is cancelled
      visible: (values) => values.status === "cancelled",
      fields: ["cancelledAt", "cancellationReason"]
    },
    {
      title: "Payment Information",
      // Show when status is completed or processing
      visible: (values) => ["completed", "processing"].includes(values.status),
      fields: ["paymentMethod", "transactionId", "amount"]
    }
  ]
}
```

### 1.5 Tabs with Sections

**Tabs containing multiple sections:**
```typescript
edit: {
  tabs: [
    {
      id: "content",
      label: "Content",
      icon: "file-text",
      sections: [
        {
          title: "Basic",
          layout: "columns",
          columns: 2,
          fields: ["title", "slug", "excerpt", "content"]
        },
        {
          title: "SEO",
          fields: ["metaTitle", "metaDescription", "keywords"]
        }
      ]
    },
    {
      id: "media",
      label: "Media",
      icon: "image",
      sections: [
        {
          title: "Images",
          fields: ["featuredImage", "gallery"]
        },
        {
          title: "Video",
          fields: ["videoUrl", "thumbnail"]
        }
      ]
    },
    {
      id: "settings",
      label: "Settings",
      icon: "settings",
      // Conditional tab visibility
      visible: (values) => values.type === "advanced",
      fields: ["publishedAt", "author", "category", "tags"]
    }
  ]
}
```

### 1.6 Sidebar Layouts

**Two-column layout with sidebar:**
```typescript
edit: {
  layout: "with-sidebar",

  // Main content
  sections: [
    {
      title: "Content",
      fields: ["title", "content", "excerpt"]
    }
  ],

  // Sidebar (meta info)
  sidebar: {
    position: "right", // or "left"
    width: "300px",
    fields: [
      "status",
      "publishedAt",
      "author",
      "category",
      "tags",
      "featuredImage"
    ]
  }
}
```

### 1.7 Custom CSS Classes

**Style sections with custom classes:**
```typescript
edit: {
  sections: [
    {
      title: "Highlighted Section",
      className: "border-2 border-primary bg-primary/5 p-6 rounded-lg",
      fields: ["importantField", "criticalData"]
    }
  ]
}
```

---

## 2. Custom Pages System

### 2.1 Registering Custom Pages

```typescript
import { defineAdminConfig } from "@questpie/admin/config";
import { SettingsPage } from "~/components/settings-page";
import { AnalyticsPage } from "~/components/analytics-page";
import { UsersManagementPage } from "~/components/users-page";

export const adminConfig = defineAdminConfig<AppCMS>()({
  app: {
    brand: { name: "My Admin" },

    // Custom pages
    pages: [
      {
        id: "settings",
        label: "Settings",
        icon: "settings",
        path: "/admin/settings",
        component: SettingsPage,
        showInNav: true,
        group: "system",
        order: 100
      },
      {
        id: "analytics",
        label: "Analytics",
        icon: "chart-bar",
        path: "/admin/analytics",
        component: AnalyticsPage,
        showInNav: true,
        group: "reporting",
        order: 50
      },
      {
        id: "users",
        label: "User Management",
        icon: "users",
        path: "/admin/users",
        component: UsersManagementPage,
        showInNav: true,
        permissions: ["admin.users.manage"]
      }
    ]
  }
});
```

### 2.2 Custom Page Component

```typescript
import { useAdminContext } from "@questpie/admin/hooks";
import { Card, Button, Input } from "@questpie/admin/components";

export function SettingsPage() {
  const { client } = useAdminContext();

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-muted-foreground">Manage your application settings</p>
      </div>

      <div className="grid grid-cols-2 gap-6">
        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">General</h2>
          <div className="space-y-4">
            <Input label="Site Name" />
            <Input label="Site URL" />
            <Button>Save Changes</Button>
          </div>
        </Card>

        <Card className="p-6">
          <h2 className="text-xl font-semibold mb-4">Email</h2>
          <div className="space-y-4">
            <Input label="SMTP Host" />
            <Input label="SMTP Port" />
            <Button>Save Changes</Button>
          </div>
        </Card>
      </div>
    </div>
  );
}
```

### 2.3 Navigation Integration

Custom pages automatically appear in sidebar:

```
Dashboard
Collections
  - Posts
  - Pages
  - Media
Reporting
  - Analytics      <- Custom page
System
  - Settings       <- Custom page
  - User Management <- Custom page (if has permission)
```

---

## 3. Dashboard System

### 3.1 Widget-Based Dashboard

```typescript
export const adminConfig = defineAdminConfig<AppCMS>()({
  app: {
    dashboard: {
      title: "Welcome Back",
      description: "Here's what's happening with your content",

      // Grid configuration
      columns: 12,
      rowHeight: 80,
      customizable: true, // Allow users to rearrange

      widgets: [
        // Stats widget
        {
          id: "total-posts",
          type: "stats",
          title: "Total Posts",
          position: { x: 0, y: 0, w: 3, h: 2 },
          config: {
            collection: "posts",
            stat: "count",
            icon: "file-text",
            color: "blue"
          }
        },

        // Chart widget
        {
          id: "posts-over-time",
          type: "chart",
          title: "Posts Over Time",
          position: { x: 3, y: 0, w: 6, h: 4 },
          config: {
            collection: "posts",
            chartType: "line",
            dateField: "createdAt",
            groupBy: "day"
          }
        },

        // Recent items widget
        {
          id: "recent-posts",
          type: "recent-items",
          title: "Recent Posts",
          position: { x: 0, y: 2, w: 6, h: 4 },
          config: {
            collection: "posts",
            limit: 5,
            columns: ["title", "author", "createdAt"],
            with: ["author"]
          }
        },

        // Quick actions widget
        {
          id: "quick-actions",
          type: "quick-actions",
          title: "Quick Actions",
          position: { x: 9, y: 0, w: 3, h: 2 },
          config: {
            actions: [
              {
                label: "New Post",
                icon: "plus",
                href: "/admin/posts/new",
                variant: "default"
              },
              {
                label: "New Page",
                icon: "file",
                href: "/admin/pages/new",
                variant: "outline"
              }
            ]
          }
        },

        // Custom widget
        {
          id: "custom-analytics",
          type: "custom",
          component: CustomAnalyticsWidget,
          position: { x: 6, y: 2, w: 6, h: 4 }
        }
      ]
    }
  }
});
```

### 3.2 Built-in Widget Types

#### Stats Widget

Shows single statistic:

```typescript
{
  type: "stats",
  config: {
    collection: "posts",           // Collection to query
    stat: "count" | "sum" | "avg", // Statistic type
    field?: "views",               // Field (for sum/avg)
    where?: { status: "published" }, // Filter
    icon: "file-text",             // Icon
    color: "blue" | "green" | "red", // Color
    trend?: {
      enabled: true,
      period: "week" // Compare to previous week
    }
  }
}
```

Renders:
```
┌─────────────────┐
│ 📄 Total Posts  │
│                 │
│      1,234      │
│   ↑ 12% vs last week
└─────────────────┘
```

#### Chart Widget

Shows data visualization:

```typescript
{
  type: "chart",
  config: {
    collection: "posts",
    chartType: "line" | "bar" | "pie" | "area",
    dateField: "createdAt",
    groupBy: "day" | "week" | "month",
    valueField?: "views", // For sum/avg
    where?: { status: "published" }
  }
}
```

#### Recent Items Widget

Shows recent collection items:

```typescript
{
  type: "recent-items",
  config: {
    collection: "posts",
    limit: 5,
    columns: ["title", "author", "createdAt"],
    with: ["author"], // Eager load
    where?: { status: "draft" }, // Filter
    linkTo: "/admin/posts/{id}" // Click action
  }
}
```

Renders:
```
┌───────────────────────────────────┐
│ Recent Posts                      │
├───────────────────────────────────┤
│ • How to Build a CMS              │
│   by John Doe - 2 hours ago       │
│                                   │
│ • Getting Started with React      │
│   by Jane Smith - 5 hours ago     │
│                                   │
│ • TypeScript Best Practices       │
│   by Bob Johnson - 1 day ago      │
└───────────────────────────────────┘
```

#### Quick Actions Widget

Shows action buttons:

```typescript
{
  type: "quick-actions",
  config: {
    actions: [
      {
        label: "New Post",
        icon: "plus",
        href: "/admin/posts/new",
        variant: "default"
      },
      {
        label: "Import Data",
        icon: "upload",
        onClick: () => handleImport(),
        variant: "outline"
      }
    ]
  }
}
```

### 3.3 Custom Widgets

```typescript
import { useQuery } from "@tanstack/react-query";
import { useAdminContext } from "@questpie/admin/hooks";
import { Card } from "@questpie/admin/components";

export function CustomAnalyticsWidget() {
  const { client } = useAdminContext();

  const { data } = useQuery({
    queryKey: ["custom-analytics"],
    queryFn: async () => {
      // Custom data fetching
      const [posts, views] = await Promise.all([
        client.collections.posts.list({ limit: 0 }),
        client.collections.pageViews.list({ limit: 0 })
      ]);

      return {
        totalPosts: posts.total,
        totalViews: views.total,
        avgViewsPerPost: views.total / posts.total
      };
    }
  });

  return (
    <Card className="p-6">
      <h3 className="text-lg font-semibold mb-4">Analytics</h3>
      <div className="space-y-2">
        <div className="flex justify-between">
          <span>Total Posts:</span>
          <strong>{data?.totalPosts}</strong>
        </div>
        <div className="flex justify-between">
          <span>Total Views:</span>
          <strong>{data?.totalViews}</strong>
        </div>
        <div className="flex justify-between">
          <span>Avg Views/Post:</span>
          <strong>{data?.avgViewsPerPost?.toFixed(2)}</strong>
        </div>
      </div>
    </Card>
  );
}
```

### 3.4 Simple Dashboard Override

For full control:

```typescript
export const adminConfig = defineAdminConfig<AppCMS>()({
  app: {
    dashboard: {
      component: CustomDashboard // Completely custom
    }
  }
});

function CustomDashboard() {
  return (
    <div className="p-8">
      <h1>My Custom Dashboard</h1>
      {/* Anything you want */}
    </div>
  );
}
```

### 3.5 Dashboard Implementation

**File:** `packages/admin/src/components/views/dashboard.tsx`

```typescript
import { useAdminContext } from "../../hooks/use-admin-context";
import type { DashboardConfig } from "../../config";
import { StatsWidget } from "../widgets/stats-widget";
import { ChartWidget } from "../widgets/chart-widget";
import { RecentItemsWidget } from "../widgets/recent-items-widget";
import { QuickActionsWidget } from "../widgets/quick-actions-widget";

export function Dashboard({ config }: { config?: DashboardConfig }) {
  // If custom component, use it
  if (config?.component) {
    const CustomDashboard = config.component;
    return <CustomDashboard />;
  }

  // If no config, show default dashboard
  if (!config?.widgets) {
    return <DefaultDashboard />;
  }

  // Render widget-based dashboard
  return (
    <div className="p-8">
      {config.title && (
        <div className="mb-6">
          <h1 className="text-3xl font-bold">{config.title}</h1>
          {config.description && (
            <p className="text-muted-foreground">{config.description}</p>
          )}
        </div>
      )}

      <div className="grid grid-cols-12 gap-4">
        {config.widgets.map((widget) => (
          <div
            key={widget.id}
            style={{
              gridColumn: `span ${widget.position?.w || 12}`,
              gridRow: `span ${widget.position?.h || 2}`
            }}
          >
            <WidgetRenderer widget={widget} />
          </div>
        ))}
      </div>
    </div>
  );
}

function WidgetRenderer({ widget }: { widget: DashboardWidget }) {
  switch (widget.type) {
    case "stats":
      return <StatsWidget {...widget} />;
    case "chart":
      return <ChartWidget {...widget} />;
    case "recent-items":
      return <RecentItemsWidget {...widget} />;
    case "quick-actions":
      return <QuickActionsWidget {...widget} />;
    case "custom":
      const CustomWidget = widget.component;
      return CustomWidget ? <CustomWidget /> : null;
    default:
      return null;
  }
}

function DefaultDashboard() {
  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold">Dashboard</h1>
      <p className="text-muted-foreground">
        Configure your dashboard in admin config
      </p>
    </div>
  );
}
```

---

## 4. Implementation Checklist

### Advanced Layouts
- [ ] Update AutoFormFields to support multi-column layouts
- [ ] Add grid layout rendering with spans
- [ ] Implement inline layouts
- [ ] Add conditional section visibility
- [ ] Implement tab sections
- [ ] Add sidebar layout support
- [ ] Support custom CSS classes

### Custom Pages
- [ ] Update AdminRouter to handle custom pages
- [ ] Add custom pages to sidebar navigation
- [ ] Implement permission checking for pages
- [ ] Add routing for custom page paths
- [ ] Support navigation groups and ordering

### Dashboard
- [ ] Create Dashboard component
- [ ] Implement StatsWidget
- [ ] Implement ChartWidget (using recharts)
- [ ] Implement RecentItemsWidget
- [ ] Implement QuickActionsWidget
- [ ] Support custom widgets
- [ ] Add widget grid layout system
- [ ] Optional: Add drag-and-drop customization

---

## 5. Usage Examples

### Complete Admin Config Example

```typescript
export const adminConfig = defineAdminConfig<AppCMS>()({
  app: {
    brand: { name: "Blog Admin" },

    // Dashboard with widgets
    dashboard: {
      title: "Dashboard",
      widgets: [
        {
          id: "stats-posts",
          type: "stats",
          title: "Total Posts",
          position: { x: 0, y: 0, w: 3, h: 2 },
          config: { collection: "posts", stat: "count" }
        },
        {
          id: "recent-posts",
          type: "recent-items",
          title: "Recent Posts",
          position: { x: 0, y: 2, w: 6, h: 4 },
          config: {
            collection: "posts",
            limit: 5,
            columns: ["title", "author", "createdAt"]
          }
        }
      ]
    },

    // Custom pages
    pages: [
      {
        id: "settings",
        label: "Settings",
        icon: "settings",
        path: "/admin/settings",
        component: SettingsPage,
        showInNav: true
      }
    ]
  },

  collections: {
    posts: {
      edit: {
        // Advanced layout with tabs and sections
        tabs: [
          {
            id: "content",
            label: "Content",
            sections: [
              {
                title: "Basic",
                layout: "grid",
                grid: { columns: 2 },
                fields: [
                  { field: "title", span: 2 },
                  { field: "slug", span: 2 },
                  { field: "excerpt", span: 2 },
                  { field: "content", span: 2 }
                ]
              }
            ]
          },
          {
            id: "settings",
            label: "Settings",
            sections: [
              {
                title: "Publication",
                layout: "columns",
                columns: 2,
                fields: ["status", "publishedAt", "author", "category"]
              }
            ]
          }
        ]
      }
    }
  }
});
```

This provides a complete, flexible system for layouts, custom pages, and dashboards!
