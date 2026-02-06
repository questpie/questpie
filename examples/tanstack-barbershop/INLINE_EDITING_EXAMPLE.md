# Inline Editing Example - Barber Profile

This example demonstrates the complete inline editing system integrated into a real application.

## Overview

The barber profile page (`/barbers/[slug]`) showcases all inline editing features:

- **Click-to-edit** text fields (name, email, phone)
- **RichText editing** with bubble menu for bio
- **Array editing** for social links
- **Auto-save** with visual feedback
- **Live preview** sync with admin panel

## File Structure

```
src/
├── lib/
│   └── getBarbers.function.ts      # Server-side data fetching
├── routes/
│   └── _app/
│       ├── barbers.index.tsx       # List all barbers
│       └── barbers.$slug.tsx       # Profile with inline editing
└── questpie/
    └── admin/
        └── collections/
            └── barbers.ts          # Admin config with RichText + preview
```

## Step-by-Step Implementation

### 1. Admin Configuration (`barbers.ts`)

```typescript
import { builder } from "@/questpie/admin/builder";

export const barbersAdmin = builder
  .collection("barbers")
  .meta({
    label: { en: "Barbers", sk: "Holiči" },
    icon: UsersIcon,
  })
  // ✨ NEW: Preview configuration
  .preview({
    url: (values) => {
      const slug = values.name?.toLowerCase().replace(/\s+/g, "-") || "barber";
      return `/barbers/${slug}?preview=true`;
    },
    enabled: true,
    position: "right",
    defaultWidth: 50,
  })
  .fields(({ r }) => ({
    name: r.text({
      label: { en: "Full Name", sk: "Cele meno" },
    }),
    email: r.email({
      label: { en: "Email Address", sk: "Emailova adresa" },
    }),
    // ✨ NEW: RichText with simple preset
    bio: r.richText({
      label: { en: "Biography", sk: "Zivotopis" },
      preset: "simple", // Only basic formatting
      showCharacterCount: true,
      maxCharacters: 1000,
    }),
    // ... other fields
  }));
```

**Key Points:**

- `.preview()` enables live preview in admin
- `preset: "simple"` gives RichText without images/tables
- Preview URL uses field values (dynamic slug)

### 2. Data Fetching (`getBarbers.function.ts`)

```typescript
import { client } from "@/lib/cms-client";
import { createServerFn } from "@tanstack/react-start";

export const getBarber = createServerFn({ method: "GET" })
  .inputValidator((data: { slug: string }) => data)
  .handler(async ({ data }) => {
    // Fetch all barbers
    const result = await client.collections.barbers.find({
      locale: "en",
    });

    // Find by slug
    const barber = result.docs.find((b: any) => {
      const slug = b.name?.toLowerCase().replace(/\s+/g, "-") || "";
      return slug === data.slug;
    });

    if (!barber) throw notFound();

    // Load relations if needed
    let services: any[] = [];
    if (barber.services?.length > 0) {
      const servicesResult = await client.collections.services.find({
        where: { id: { in: barber.services } },
        locale: "en",
      });
      services = servicesResult.docs;
    }

    return { barber: { ...barber, services } };
  });
```

**Key Points:**

- Use `find()` for paginated results, not `findMany()`
- Result is `{ docs: [...], totalDocs, ... }`
- Load relations separately if needed

### 3. Profile Page (`barbers.$slug.tsx`)

#### Setup Route

```typescript
import { getBarber } from "@/lib/getBarbers.function";
import {
  EditablePreviewField,
  InlineArrayEditor,
  InlineEditingProvider,
  InlineRichTextEditor,
  PreviewBanner,
  PreviewProvider,
  useCollectionPreview,
} from "@questpie/admin/client";

export const Route = createFileRoute("/_app/barbers/$slug")({
  loader: async (ctx) => {
    return getBarber({ data: { slug: ctx.params.slug } });
  },
  component: BarberProfileComponent,
});
```

#### Component Structure

```typescript
function BarberProfileComponent() {
  const { barber } = Route.useLoaderData() as any;
  const router = useRouter();

  // ✨ Preview hook - enables live updates from admin
  const {
    data,
    isPreviewMode,
    focusedField,
    handleFieldClick,
  } = useCollectionPreview({
    initialData: barber,
    onRefresh: () => {
      router.invalidate(); // Re-run loader
    },
  });

  // ✨ Save handler for inline editing
  const handleSave = async (fieldPath: string, value: any) => {
    await client.collections.barbers.update(
      data.id,
      { [fieldPath]: value },
    );
  };

  return (
    <InlineEditingProvider initialEnabled={isPreviewMode}>
      <PreviewProvider
        isPreviewMode={isPreviewMode}
        focusedField={focusedField}
        onFieldClick={handleFieldClick}
      >
        <PreviewBanner isPreviewMode={isPreviewMode} />
        {/* ... content ... */}
      </PreviewProvider>
    </InlineEditingProvider>
  );
}
```

**Key Points:**

- `useCollectionPreview` handles admin communication
- `InlineEditingProvider` enables inline editing
- `PreviewProvider` handles field clicks
- `PreviewBanner` shows preview status

#### Text Field Inline Editing

```typescript
<EditablePreviewField
  fieldPath="name"
  value={data.name}
  onSave={(value) => handleSave("name", value)}
  editable={isPreviewMode}
>
  <h1 className="text-4xl font-bold">{data.name}</h1>
</EditablePreviewField>
```

**Behavior:**

- In preview mode: Click to edit
- Shows auto-save spinner
- Success/error feedback
- Escape to cancel, Enter to save

#### RichText Field Inline Editing

```typescript
<EditablePreviewField
  fieldPath="bio"
  value={data.bio}
  onSave={(value) => handleSave("bio", value)}
  editable={isPreviewMode}
  multiline={true}
  render={(value) => (
    <InlineRichTextEditor
      name="bio"
      value={value}
      onChange={(val) => console.log("Bio changed:", val)}
      outputFormat="html"
    />
  )}
>
  <div
    className="prose"
    dangerouslySetInnerHTML={{ __html: data.bio }}
  />
</EditablePreviewField>
```

**Features:**

- Bubble menu on text selection
- Simple preset (headings, lists, formatting, links)
- No toolbar (clean inline UI)
- Auto-saves after 500ms

#### Array Field Inline Editing

```typescript
{isPreviewMode ? (
  <InlineArrayEditor
    value={data.socialLinks?.map((link: any) => link.url) || []}
    onChange={(urls) => {
      const updatedLinks = urls.map((url, i) => ({
        platform: data.socialLinks[i]?.platform || "instagram",
        url,
      }));
      handleSave("socialLinks", updatedLinks);
    }}
    placeholder="Add social link..."
    maxItems={5}
  />
) : (
  <div className="flex flex-wrap gap-2">
    {data.socialLinks.map((link: any, index: number) => (
      <a key={index} href={link.url} target="_blank">
        {link.platform}
      </a>
    ))}
  </div>
)}
```

**Features:**

- Click badge to edit
- X button to remove
- ↑↓ buttons to reorder
- Enter to add new item
- Validation (maxItems, minItems)

## Usage Flow

### As a Content Editor

1. **Open Admin Panel**
   - Navigate to Barbers collection
   - Click on a barber entry
   - Click "Live Preview" button

2. **Edit Inline**
   - Preview opens in split pane
   - Click any field to edit directly
   - Changes save automatically
   - See updates in real-time

3. **Edit Different Field Types**
   - **Text fields:** Click → type → auto-saves
   - **Bio (RichText):** Click → select text → bubble menu appears → format text
   - **Social links:** Click badge → edit URL → Enter

### As a Developer

1. **Enable Preview**
   - Add `.preview()` to collection admin config
   - Define preview URL pattern

2. **Create Preview Route**
   - Use `useCollectionPreview` hook
   - Wrap with `InlineEditingProvider`
   - Add `PreviewBanner`

3. **Make Fields Editable**
   - Wrap content in `EditablePreviewField`
   - Provide `onSave` handler
   - Use specialized editors for rich types

## Advanced Features

### Conditional Editing

```typescript
<EditablePreviewField
  fieldPath="email"
  value={data.email}
  onSave={handleSave}
  editable={isPreviewMode && hasPermission}
>
  {data.email}
</EditablePreviewField>
```

### Custom Validation

```typescript
<EditablePreviewField
  fieldPath="phone"
  value={data.phone}
  onSave={async (value) => {
    if (!/^\+?[0-9\s-]+$/.test(value)) {
      throw new Error("Invalid phone number format");
    }
    await handleSave("phone", value);
  }}
>
  {data.phone}
</EditablePreviewField>
```

### Global Enable/Disable

```typescript
const { enabled, setEnabled } = useInlineEditing();

<Button onClick={() => setEnabled(!enabled)}>
  {enabled ? "Disable" : "Enable"} Editing
</Button>
```

## Common Issues

### Issue: Changes not saving

**Cause:** Update API signature incorrect

```typescript
// ❌ Wrong
await client.collections.barbers.update({
  where: { id: data.id },
  data: { name: value },
});

// ✅ Correct
await client.collections.barbers.update(data.id, { name: value });
```

### Issue: Preview not loading

**Check:**

1. Preview URL is correct in admin config
2. Route accepts `?preview=true` query param
3. `useCollectionPreview` is called

### Issue: Inline editing not working

**Check:**

1. `InlineEditingProvider` wraps component
2. `editable={isPreviewMode}` is set
3. `onSave` handler is provided

## Performance Tips

1. **Debounce saves**: Default 500ms, adjust via `autoSaveDelay`
2. **Optimize re-renders**: Use `React.memo` for complex fields
3. **Lazy load relations**: Only fetch when needed
4. **Cache responses**: Use TanStack Query for data fetching

## Next Steps

1. **Add more collections**: Apply same pattern to other collections
2. **Custom field editors**: Create custom inline editors for specific needs
3. **Bulk operations**: Extend for multi-field updates
4. **Collaborative editing**: Add real-time collaboration (future)

## References

- Full API: `/packages/admin/src/client/preview/INLINE_EDITING.md`
- RichText docs: `/packages/admin/src/client/components/fields/rich-text-editor/README.md`
- Example source: `/examples/tanstack-barbershop/src/routes/_app/barbers.$slug.tsx`
