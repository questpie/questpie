# Admin Hooks

React hooks for data fetching and admin functionality. Built on TanStack Query.

## Setup

Hooks require `AdminProvider` to be mounted in your app:

```tsx
import { AdminLayoutProvider } from "@questpie/admin/views/layout";
import { Admin } from "@questpie/admin/builder";
import { admin } from "./admin";

function App() {
  return (
    <AdminLayoutProvider
      admin={Admin.from(admin)}
      client={cmsClient}
      queryClient={queryClient}
      LinkComponent={Link}
      basePath="/admin"
    >
      {children}
    </AdminLayoutProvider>
  );
}
```

## Realtime Behavior

- `useCollectionList`, `useCollectionCount`, and `useGlobal` automatically consume SSE snapshots when realtime is enabled in `AdminProvider`.
- Realtime is enabled by default in `AdminProvider`.
- Hooks apply snapshot payloads to query cache when possible and fall back to `invalidateQueries` when snapshot mapping is unavailable.
- `AdminProvider` supports `realtime.debounceMs` to debounce cache updates/invalidation during rapid bursts (set `0` for immediate updates).
- You can disable per-hook call:

```tsx
const { data } = useCollectionList("posts", { limit: 10 }, undefined, {
  realtime: false,
});
```

## Collection Hooks

### useCollectionList

Fetch paginated list with filters and sorting:

```tsx
import { useCollectionList } from "@questpie/admin/hooks";

function PostsList() {
  const { data, isLoading, error } = useCollectionList("posts", {
    limit: 10,
    offset: 0,
    where: { status: { eq: "published" } },
    orderBy: { createdAt: "desc" },
    with: { author: true },
  });

  if (isLoading) return <Spinner />;
  if (error) return <Error message={error.message} />;

  return (
    <ul>
      {data?.docs.map((post) => (
        <li key={post.id}>{post.title}</li>
      ))}
    </ul>
  );
}
```

### useCollectionItem

Fetch single item by ID:

```tsx
import { useCollectionItem } from "@questpie/admin/hooks";

function PostDetail({ id }: { id: string }) {
  const { data: post, isLoading } = useCollectionItem("posts", id, {
    with: { author: true, tags: true },
  });

  if (isLoading) return <Spinner />;
  if (!post) return <NotFound />;

  return (
    <article>
      <h1>{post.title}</h1>
      <p>By {post.author?.name}</p>
    </article>
  );
}
```

### useCollectionCreate

Create new items:

```tsx
import { useCollectionCreate } from "@questpie/admin/hooks";

function CreatePost() {
  const createPost = useCollectionCreate("posts", {
    onSuccess: (data) => {
      console.log("Created:", data);
    },
  });

  const handleSubmit = (data) => {
    createPost.mutate(data);
  };

  return (
    <form onSubmit={handleSubmit}>
      {/* form fields */}
      <button disabled={createPost.isPending}>
        {createPost.isPending ? "Creating..." : "Create"}
      </button>
    </form>
  );
}
```

### useCollectionUpdate

Update existing items:

```tsx
import { useCollectionUpdate } from "@questpie/admin/hooks";

function EditPost({ id }: { id: string }) {
  const updatePost = useCollectionUpdate("posts", {
    onSuccess: () => {
      console.log("Updated!");
    },
  });

  const handleSave = (data) => {
    updatePost.mutate({ id, data });
  };

  return (
    <form onSubmit={handleSave}>
      {/* form fields */}
      <button disabled={updatePost.isPending}>
        {updatePost.isPending ? "Saving..." : "Save"}
      </button>
    </form>
  );
}
```

### useCollectionDelete

Delete items:

```tsx
import { useCollectionDelete } from "@questpie/admin/hooks";

function DeleteButton({ id }: { id: string }) {
  const deletePost = useCollectionDelete("posts", {
    onSuccess: () => {
      console.log("Deleted!");
    },
  });

  return (
    <button
      onClick={() => deletePost.mutate(id)}
      disabled={deletePost.isPending}
    >
      {deletePost.isPending ? "Deleting..." : "Delete"}
    </button>
  );
}
```

## Global Hooks

### useGlobal

Fetch global settings:

```tsx
import { useGlobal } from "@questpie/admin/hooks";

function Settings() {
  const { data: settings, isLoading } = useGlobal("siteSettings");

  if (isLoading) return <Spinner />;

  return (
    <div>
      <h1>{settings?.siteName}</h1>
    </div>
  );
}
```

### useGlobalUpdate

Update global settings:

```tsx
import { useGlobalUpdate } from "@questpie/admin/hooks";

function SettingsForm() {
  const updateSettings = useGlobalUpdate("siteSettings");

  const handleSave = (data) => {
    updateSettings.mutate(data);
  };

  return <form onSubmit={handleSave}>{/* form fields */}</form>;
}
```

## Admin Store Hooks

### useAdminStore

Access admin store state with selectors:

```tsx
import {
  useAdminStore,
  selectClient,
  selectBasePath,
} from "@questpie/admin/hooks";

function MyComponent() {
  const client = useAdminStore(selectClient);
  const basePath = useAdminStore(selectBasePath);

  // Multiple selectors
  const { admin, locale } = useAdminStore((s) => ({
    admin: s.admin,
    locale: s.locale,
  }));
}
```

Available selectors:

- `selectAdmin` - Admin builder instance
- `selectClient` - CMS client
- `selectBasePath` - Base path for admin routes
- `selectBrandName` - Brand name from config
- `selectLocale` - Current locale
- `selectSetLocale` - Locale setter function
- `selectNavigate` - Navigation function
- `selectNavigation` - Navigation state

### useAdminContext

Get full admin context (legacy, prefer `useAdminStore`):

```tsx
import { useAdminContext } from "@questpie/admin/hooks";

function MyComponent() {
  const { admin, client, queryClient } = useAdminContext();
}
```

## Auth Hooks

### useAuthClient

Access Better Auth client:

```tsx
import { useAuthClient } from "@questpie/admin/hooks";

function UserMenu() {
  const authClient = useAuthClient();
  const session = authClient.useSession();

  if (!session.data?.user) {
    return <LoginButton />;
  }

  return (
    <div>
      <span>{session.data.user.email}</span>
      <button onClick={() => authClient.signOut()}>Sign Out</button>
    </div>
  );
}
```

### createAdminAuthClient

Create auth client instance:

```tsx
import { createAdminAuthClient } from "@questpie/admin/hooks";

const authClient = createAdminAuthClient({
  baseURL: "http://localhost:3000",
  basePath: "/api/auth",
});
```

## Route Hooks

### useAdminRoutes

Type-safe navigation helpers:

```tsx
import { useAdminRoutes } from "@questpie/admin/hooks";

function Navigation() {
  const { routes, navigate } = useAdminRoutes();

  // Get URLs
  const postsUrl = routes.collection("posts");
  const newPostUrl = routes.collectionCreate("posts");
  const editPostUrl = routes.collectionEdit("posts", "123");
  const settingsUrl = routes.global("siteSettings");

  // Navigate programmatically
  const goToPost = () => {
    navigate({ collection: "posts", action: "edit", id: "123" });
  };

  return (
    <nav>
      <a href={postsUrl}>Posts</a>
      <button onClick={goToPost}>Edit Post</button>
    </nav>
  );
}
```

### getAdminLinkHref

Get href for admin routes:

```tsx
import { getAdminLinkHref } from "@questpie/admin/hooks";

const href = getAdminLinkHref(
  {
    collection: "posts",
    action: "edit",
    id: "123",
  },
  "/admin",
);
// => "/admin/collections/posts/123"
```

## Type Safety with Module Augmentation

For full type inference, register your CMS types:

```typescript
// admin.ts
import type { AppCMS } from "./server/cms";

declare module "@questpie/admin/builder" {
  interface AdminTypeRegistry {
    cms: AppCMS;
    admin: typeof admin;
  }
}
```

Now all hooks have full type inference:

```tsx
// Types inferred automatically!
const { data } = useCollectionList("posts");
// data?.docs is typed as Post[]

const { data: post } = useCollectionItem("posts", id);
// post is typed as Post | undefined
```

## API Reference

### Collection Hooks

| Hook                  | Parameters                                                | Returns                               |
| --------------------- | --------------------------------------------------------- | ------------------------------------- |
| `useCollectionList`   | `(collection, options?, queryOptions?, realtimeOptions?)` | `UseQueryResult<{ docs, totalDocs }>` |
| `useCollectionCount`  | `(collection, options?, queryOptions?, realtimeOptions?)` | `UseQueryResult<number>`              |
| `useCollectionItem`   | `(collection, id, options?, queryOptions?)`               | `UseQueryResult<Item>`                |
| `useCollectionCreate` | `(collection, mutationOptions?)`                          | `UseMutationResult`                   |
| `useCollectionUpdate` | `(collection, mutationOptions?)`                          | `UseMutationResult`                   |
| `useCollectionDelete` | `(collection, mutationOptions?)`                          | `UseMutationResult`                   |

### Global Hooks

| Hook              | Parameters                                            | Returns                      |
| ----------------- | ----------------------------------------------------- | ---------------------------- |
| `useGlobal`       | `(global, options?, queryOptions?, realtimeOptions?)` | `UseQueryResult<GlobalData>` |
| `useGlobalUpdate` | `(global, mutationOptions?)`                          | `UseMutationResult`          |

### Store Hooks

| Hook              | Parameters   | Returns                          |
| ----------------- | ------------ | -------------------------------- |
| `useAdminStore`   | `(selector)` | Selected state                   |
| `useAdminContext` | none         | `{ admin, client, queryClient }` |

### Auth Hooks

| Hook                    | Parameters  | Returns                    |
| ----------------------- | ----------- | -------------------------- |
| `useAuthClient`         | none        | Better Auth client         |
| `useAuthClientSafe`     | none        | Better Auth client or null |
| `createAdminAuthClient` | `(options)` | Better Auth client         |

### Route Hooks

| Hook                       | Parameters             | Returns                |
| -------------------------- | ---------------------- | ---------------------- |
| `useAdminRoutes`           | `(options?)`           | `{ routes, navigate }` |
| `useAdminRoutesStandalone` | `(basePath, options?)` | `{ routes, navigate }` |
| `getAdminLinkHref`         | `(props, basePath)`    | `string`               |
