# Rich Text Editor & Block Editor Implementation Plan

## Overview

Implementation plan for two high-priority editor components:
1. **Rich Text Editor** - Using Tiptap for WYSIWYG content editing
2. **Block Editor** - Using Puck for visual page building

Both marked as **HIGH PRIORITY** by user.

---

## 1. Rich Text Editor (Tiptap)

### 1.1 Dependencies

```json
{
  "@tiptap/react": "^2.x",
  "@tiptap/starter-kit": "^2.x",
  "@tiptap/extension-link": "^2.x",
  "@tiptap/extension-image": "^2.x",
  "@tiptap/extension-table": "^2.x",
  "@tiptap/extension-table-row": "^2.x",
  "@tiptap/extension-table-cell": "^2.x",
  "@tiptap/extension-table-header": "^2.x",
  "@tiptap/extension-placeholder": "^2.x",
  "@tiptap/extension-text-align": "^2.x",
  "@tiptap/extension-underline": "^2.x",
  "@tiptap/extension-code-block-lowlight": "^2.x",
  "lowlight": "^3.x"
}
```

### 1.2 Component Structure

```
packages/admin/src/components/fields/
├── rich-text-editor/
│   ├── index.tsx                    # Main component
│   ├── toolbar.tsx                  # Formatting toolbar
│   ├── bubble-menu.tsx              # Floating menu
│   ├── extensions.ts                # Tiptap extensions config
│   ├── menu-items.tsx               # Toolbar buttons
│   └── styles.css                   # Editor styles
```

### 1.3 Features

**Basic Formatting:**
- Bold, Italic, Underline, Strike
- Headings (H1-H6)
- Paragraph, Blockquote
- Code inline and code blocks with syntax highlighting

**Lists:**
- Ordered lists
- Unordered lists
- Task lists (checkboxes)

**Advanced:**
- Links (with URL input)
- Images (with upload integration)
- Tables (insert, delete rows/columns)
- Text alignment (left, center, right, justify)
- Horizontal rule

**UX:**
- Placeholder text
- Character/word count
- Markdown shortcuts (e.g., `# ` for heading)
- Bubble menu for quick formatting
- Slash commands (optional)

**Output Formats:**
- JSON (Tiptap's native format)
- HTML (for rendering)
- Markdown (optional)

### 1.4 Component API

```typescript
export interface RichTextEditorProps {
  /**
   * Field name
   */
  name: string;

  /**
   * Current value (JSON or HTML)
   */
  value?: any;

  /**
   * Change handler
   */
  onChange: (value: any) => void;

  /**
   * Placeholder text
   */
  placeholder?: string;

  /**
   * Is disabled
   */
  disabled?: boolean;

  /**
   * Is readonly
   */
  readOnly?: boolean;

  /**
   * Output format
   */
  outputFormat?: "json" | "html" | "markdown";

  /**
   * Custom extensions
   */
  extensions?: Extension[];

  /**
   * Show character count
   */
  showCharacterCount?: boolean;

  /**
   * Max character limit
   */
  maxCharacters?: number;

  /**
   * Enable image uploads
   */
  enableImages?: boolean;

  /**
   * Image upload handler
   */
  onImageUpload?: (file: File) => Promise<string>;

  /**
   * Error message
   */
  error?: string;
}
```

### 1.5 Usage Example

```typescript
// In admin config
fields: {
  content: {
    label: "Content",
    type: "richText",
    placeholder: "Start writing...",
    outputFormat: "json", // or "html"
    enableImages: true,
    maxCharacters: 10000,
    showCharacterCount: true
  }
}
```

### 1.6 Implementation Steps

1. **Install dependencies** - Add Tiptap packages
2. **Create base editor component** - Basic Tiptap setup
3. **Create toolbar component** - Formatting buttons
4. **Add extensions** - StarterKit + custom extensions
5. **Implement image upload** - Integration with CMS storage
6. **Add bubble menu** - Floating formatting menu
7. **Style editor** - Match admin UI design
8. **Register in field registry** - Add `richText` field type
9. **Update AutoFormFields** - Detect `richText` type
10. **Add to documentation** - Usage examples

### 1.7 Storage Format

**Recommended: JSON (Tiptap native)**
```json
{
  "type": "doc",
  "content": [
    {
      "type": "heading",
      "attrs": { "level": 1 },
      "content": [{ "type": "text", "text": "Hello World" }]
    },
    {
      "type": "paragraph",
      "content": [
        { "type": "text", "text": "This is " },
        { "type": "text", "marks": [{ "type": "bold" }], "text": "bold" }
      ]
    }
  ]
}
```

**Database Column:**
```typescript
import { jsonb } from "drizzle-orm/pg-core";

defineCollection("posts")
  .fields({
    content: jsonb("content") // Store as JSONB
  })
```

---

## 2. Block Editor (Puck)

### 2.1 Dependencies

```json
{
  "@measured/puck": "^0.x",
  "@measured/puck/dist/index.css": "styles"
}
```

**Note:** Check React 19 compatibility - may need to wait for stable version or use alpha/beta.

### 2.2 Component Structure

```
packages/admin/src/components/fields/
├── block-editor/
│   ├── index.tsx                    # Main component
│   ├── blocks/                      # Default blocks
│   │   ├── text-block.tsx
│   │   ├── image-block.tsx
│   │   ├── button-block.tsx
│   │   ├── hero-block.tsx
│   │   ├── columns-block.tsx
│   │   ├── card-block.tsx
│   │   └── index.ts
│   ├── preview.tsx                  # Preview renderer
│   ├── block-registry.ts            # Block registration system
│   └── styles.css                   # Puck overrides
```

### 2.3 Features

**Core:**
- Drag-and-drop block composition
- Visual editing
- Real-time preview
- Responsive design controls
- Component tree view
- Undo/redo

**Default Blocks:**
- **Text** - Rich text content
- **Image** - Image with caption
- **Button** - CTA button
- **Hero** - Hero section with background
- **Columns** - Multi-column layout
- **Card** - Card component
- **Spacer** - Vertical spacing
- **Divider** - Horizontal line
- **Video** - Video embed
- **Code** - Code snippet

**Advanced:**
- Custom block registration
- Block categories
- Block presets/templates
- Copy/paste blocks
- Import/export compositions

### 2.4 Component API

```typescript
export interface BlockEditorProps {
  /**
   * Field name
   */
  name: string;

  /**
   * Current value (Puck data)
   */
  value?: PuckData;

  /**
   * Change handler
   */
  onChange: (value: PuckData) => void;

  /**
   * Available blocks
   */
  blocks?: Record<string, ComponentConfig>;

  /**
   * Is disabled
   */
  disabled?: boolean;

  /**
   * Is readonly (preview only)
   */
  readOnly?: boolean;

  /**
   * Initial viewport width
   */
  viewport?: "mobile" | "tablet" | "desktop";

  /**
   * Custom categories
   */
  categories?: {
    [category: string]: {
      blocks: string[];
      title?: string;
    };
  };

  /**
   * Error message
   */
  error?: string;
}
```

### 2.5 Block Component Interface

```typescript
import { ComponentConfig } from "@measured/puck";

export const TextBlock: ComponentConfig = {
  label: "Text",
  fields: {
    text: {
      type: "textarea",
      label: "Text Content"
    },
    align: {
      type: "select",
      label: "Alignment",
      options: [
        { label: "Left", value: "left" },
        { label: "Center", value: "center" },
        { label: "Right", value: "right" }
      ]
    }
  },
  defaultProps: {
    text: "Enter your text here...",
    align: "left"
  },
  render: ({ text, align }) => (
    <div style={{ textAlign: align }}>
      <p>{text}</p>
    </div>
  )
};
```

### 2.6 Usage Example

```typescript
// In admin config
import { TextBlock, ImageBlock, HeroBlock } from "@questpie/admin/blocks";

fields: {
  pageContent: {
    label: "Page Content",
    type: "blocks",
    blocks: {
      // Use default blocks
      text: TextBlock,
      image: ImageBlock,
      hero: HeroBlock,

      // Or define custom blocks
      customCTA: {
        label: "Custom CTA",
        fields: {
          title: { type: "text" },
          buttonText: { type: "text" },
          buttonUrl: { type: "text" }
        },
        render: (props) => <CustomCTA {...props} />
      }
    },
    categories: {
      layout: {
        title: "Layout",
        blocks: ["columns", "spacer"]
      },
      content: {
        title: "Content",
        blocks: ["text", "image", "video"]
      }
    }
  }
}
```

### 2.7 Storage Format

**Puck Data Structure:**
```json
{
  "content": [
    {
      "type": "Hero",
      "props": {
        "title": "Welcome to Our Site",
        "subtitle": "Build amazing things",
        "backgroundImage": "/uploads/hero.jpg"
      }
    },
    {
      "type": "Columns",
      "props": {
        "columns": [
          {
            "content": [
              {
                "type": "Text",
                "props": {
                  "text": "Column 1 content"
                }
              }
            ]
          }
        ]
      }
    }
  ],
  "root": {
    "props": {
      "title": "My Page"
    }
  }
}
```

**Database Column:**
```typescript
import { jsonb } from "drizzle-orm/pg-core";

defineCollection("pages")
  .fields({
    content: jsonb("content") // Store as JSONB
  })
```

### 2.8 Implementation Steps

1. **Check React 19 compatibility** - Verify Puck works with React 19
2. **Install dependencies** - Add Puck package
3. **Create base editor component** - Basic Puck setup
4. **Create default blocks** - Text, Image, Button, Hero, etc.
5. **Implement block registry** - Allow custom block registration
6. **Add preview renderer** - Render Puck data on frontend
7. **Style editor** - Match admin UI design
8. **Register in field registry** - Add `blocks` field type
9. **Update AutoFormFields** - Detect `blocks` type
10. **Add to documentation** - Usage examples and custom block guide

### 2.9 Localization in Block Editor

**IMPORTANT:** Localization for block content requires special handling.

**Approaches:**

**Option 1: Locale-specific Fields**
```typescript
// Store separate block data per locale
defineCollection("pages")
  .fields({
    contentEn: jsonb("content_en"), // English blocks
    contentSk: jsonb("content_sk"), // Slovak blocks
    contentCs: jsonb("content_cs"), // Czech blocks
  })
```

**Option 2: Embedded Locale Data**
```typescript
// Store locale data within block props
{
  "content": [
    {
      "type": "Hero",
      "props": {
        "title": {
          "en": "Welcome",
          "sk": "Vitajte",
          "cs": "Vítejte"
        },
        "subtitle": {
          "en": "Build amazing things",
          "sk": "Tvorte úžasné veci",
          "cs": "Tvořte úžasné věci"
        }
      }
    }
  ]
}
```

**Option 3: Locale Switcher in Editor (Recommended)**
```typescript
export interface BlockEditorProps {
  // ...existing props...

  /**
   * Current locale for editing
   */
  locale?: string;

  /**
   * Available locales
   */
  availableLocales?: string[];

  /**
   * Locale change handler
   */
  onLocaleChange?: (locale: string) => void;
}
```

**Implementation:**
- Show locale switcher in editor toolbar
- Load/save locale-specific block data
- Allow copying blocks from one locale to another
- Show preview in selected locale

**Config Example:**
```typescript
fields: {
  content: {
    type: "blocks",
    localized: true, // Enable locale-specific editing
    blocks: {
      text: TextBlock,
      image: ImageBlock
    }
  }
}
```

**Database Schema:**
```typescript
// Approach 1: Use CMS built-in localization
defineCollection("pages")
  .fields({
    content: jsonb("content")
  })
  .localized(true) // Use CMS localization system

// Approach 2: Manual locale fields
defineCollection("pages")
  .fields({
    content: jsonb("content").$type<Record<string, PuckData>>()
  })
```

### 2.10 Frontend Rendering

**Preview Component:**
```typescript
import { Render } from "@measured/puck";

export function PagePreview({ data, blocks, locale }) {
  // If using locale-specific data
  const localizedData = locale ? data[locale] : data;

  return <Render config={{ components: blocks }} data={localizedData} />;
}
```

**Usage in App:**
```typescript
import { PagePreview } from "@/components/page-preview";

function Page({ pageData, locale }) {
  return (
    <PagePreview
      data={pageData.content}
      blocks={blockRegistry}
      locale={locale}
    />
  );
}
```

---

## 3. Integration with Admin Package

### 3.1 Field Type Registration

```typescript
// packages/admin/src/components/views/auto-form-fields.tsx

// Add to type inference
function inferFieldType(collection: string, fieldName: string) {
  // ...existing code...

  if (fieldName.includes("content") || fieldName.includes("body")) {
    return "richText"; // Default to rich text for content fields
  }

  if (fieldName.includes("page") || fieldName.includes("builder")) {
    return "blocks"; // Block editor for page builders
  }

  // ...existing code...
}

// Add to FieldRenderer
if (type === "richText" || fieldConfig?.type === "richText") {
  return (
    <RichTextEditor
      key={fieldName}
      name={fieldName}
      value={formValues[fieldName]}
      onChange={(value) => {
        // TODO: Update form values
      }}
      placeholder={fieldConfig?.placeholder}
      disabled={isDisabled}
      readOnly={isReadOnly}
      {...fieldConfig?.richText}
    />
  );
}

if (type === "blocks" || fieldConfig?.type === "blocks") {
  return (
    <BlockEditor
      key={fieldName}
      name={fieldName}
      value={formValues[fieldName]}
      onChange={(value) => {
        // TODO: Update form values
      }}
      blocks={fieldConfig?.blocks}
      disabled={isDisabled}
      readOnly={isReadOnly}
    />
  );
}
```

### 3.2 Config Type Extensions

```typescript
// packages/admin/src/config/index.ts

export type FieldConfig = {
  // ...existing fields...

  /**
   * Rich text editor configuration
   */
  richText?: {
    outputFormat?: "json" | "html" | "markdown";
    enableImages?: boolean;
    maxCharacters?: number;
    showCharacterCount?: boolean;
    extensions?: any[]; // Tiptap extensions
  };

  /**
   * Block editor configuration
   */
  blocks?: Record<string, ComponentConfig>;

  /**
   * Block categories
   */
  blockCategories?: {
    [category: string]: {
      blocks: string[];
      title?: string;
    };
  };
};
```

---

## 4. Testing Strategy

### 4.1 Rich Text Editor Tests

- [ ] Renders empty editor with placeholder
- [ ] Formats text (bold, italic, etc.)
- [ ] Creates lists (ordered, unordered)
- [ ] Inserts links
- [ ] Uploads and inserts images
- [ ] Creates tables
- [ ] Saves in correct output format (JSON/HTML)
- [ ] Shows character count when enabled
- [ ] Enforces character limit
- [ ] Works in readonly mode
- [ ] Works in disabled mode

### 4.2 Block Editor Tests

- [ ] Renders empty canvas
- [ ] Drag and drop blocks
- [ ] Edit block properties
- [ ] Delete blocks
- [ ] Reorder blocks
- [ ] Undo/redo operations
- [ ] Saves block data correctly
- [ ] Renders preview correctly
- [ ] Custom blocks work
- [ ] Works in readonly mode

---

## 5. Documentation Requirements

### 5.1 Rich Text Editor Docs

1. **Basic Usage** - Simple rich text field
2. **Image Uploads** - Integration with CMS storage
3. **Custom Extensions** - Adding Tiptap extensions
4. **Output Formats** - JSON vs HTML vs Markdown
5. **Styling** - Customizing editor appearance
6. **Keyboard Shortcuts** - List of shortcuts

### 5.2 Block Editor Docs

1. **Basic Usage** - Simple block field
2. **Default Blocks** - List and examples
3. **Custom Blocks** - Creating custom blocks
4. **Block Categories** - Organizing blocks
5. **Frontend Rendering** - Using Render component
6. **Block Props** - Configuring block fields
7. **Best Practices** - Tips for block design

---

## 6. Implementation Timeline

### Phase 1: Rich Text Editor (2-3 days)
- Day 1: Setup, basic editor, toolbar
- Day 2: Extensions, image upload, styling
- Day 3: Integration, testing, documentation

### Phase 2: Block Editor (3-4 days)
- Day 1: Setup, basic editor, verify React 19 compatibility
- Day 2: Default blocks creation
- Day 3: Block registry, custom blocks
- Day 4: Integration, testing, documentation

**Total Estimated Time:** 5-7 days

---

## 7. Package Size Considerations

**Tiptap Bundle Size:**
- @tiptap/react: ~50KB
- @tiptap/starter-kit: ~40KB
- Extensions: ~10KB each
- **Total: ~100-150KB gzipped**

**Puck Bundle Size:**
- @measured/puck: ~150-200KB gzipped

**Mitigation:**
- Both can be code-split
- Lazy load editors only when needed
- Tree-shake unused extensions

---

## 8. Future Enhancements

### Rich Text Editor
- [ ] Collaborative editing (Yjs)
- [ ] Comments and suggestions
- [ ] Mentions (@user)
- [ ] Slash commands menu
- [ ] Custom node types
- [ ] Export to PDF

### Block Editor
- [ ] Block templates library
- [ ] A/B testing blocks
- [ ] Analytics integration
- [ ] SEO preview
- [ ] Mobile app preview
- [ ] Block marketplace

---

## 9. Dependencies Summary

Add to `packages/admin/package.json`:

```json
{
  "dependencies": {
    "@tiptap/react": "^2.x",
    "@tiptap/starter-kit": "^2.x",
    "@tiptap/extension-link": "^2.x",
    "@tiptap/extension-image": "^2.x",
    "@tiptap/extension-table": "^2.x",
    "@tiptap/extension-table-row": "^2.x",
    "@tiptap/extension-table-cell": "^2.x",
    "@tiptap/extension-table-header": "^2.x",
    "@tiptap/extension-placeholder": "^2.x",
    "@tiptap/extension-text-align": "^2.x",
    "@tiptap/extension-underline": "^2.x",
    "@tiptap/extension-code-block-lowlight": "^2.x",
    "lowlight": "^3.x",
    "@measured/puck": "^0.x"
  }
}
```

**Action Required:** Check exact versions and React 19 compatibility before installing.
