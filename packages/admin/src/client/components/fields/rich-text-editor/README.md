# RichText Editor

Modern, icon-based rich text editor built on Tiptap with feature presets for common use cases.

## Features

- 🎨 **Icon-based toolbar** using Iconify icons (Phosphor set)
- ⌨️ **Keyboard shortcuts** (⌘B, ⌘I, ⌘U, etc.)
- 🎯 **Feature presets** for quick configuration
- 🧩 **Modular architecture** for easy customization
- 🌙 **Theme support** (light/dark mode)
- 📝 **Slash commands** for quick insertions
- 💬 **Bubble menu** for selection-based formatting
- 📊 **Character counting** with limits
- 🖼️ **Image upload** support
- 📋 **Table editing** with full controls

## Quick Start

### Using Presets

The easiest way to use the RichText editor is with presets:

```tsx
import { RichTextSimple } from "@questpie/admin/client";

// Simple editor - perfect for blog posts
<RichTextSimple
  name="content"
  value={content}
  onChange={setContent}
  placeholder="Start writing..."
/>;
```

## Available Presets

### 1. **Minimal** - Inline editing only

Perfect for: Comments, notes, simple text fields

```tsx
import { RichTextMinimal } from "@questpie/admin/client";

<RichTextMinimal name="comment" value={comment} onChange={setComment} />;
```

**Features:**

- No toolbar (only bubble menu on selection)
- Bold, Italic, Underline, Link
- Minimal UI footprint

---

### 2. **Simple** - Basic rich text

Perfect for: Blog posts, articles, descriptions

```tsx
import { RichTextSimple } from "@questpie/admin/client";

<RichTextSimple
  name="description"
  value={description}
  onChange={setDescription}
  showCharacterCount
  maxCharacters={500}
/>;
```

**Features:**

- Headings (H1-H6)
- Text formatting (bold, italic, underline, strikethrough, code)
- Lists (bullet, numbered)
- Blockquotes
- Horizontal rules
- Links
- Slash commands
- Character count

---

### 3. **Standard** - Full-featured (default)

Perfect for: General-purpose content editing

```tsx
import { RichTextStandard } from "@questpie/admin/client";

<RichTextStandard
  name="content"
  value={content}
  onChange={setContent}
  onImageUpload={handleImageUpload}
/>;
```

**Features:**

- Everything in Simple
- Text alignment (left, center, right, justify)
- Images (URL + upload)
- Tables with full controls
- Code blocks with syntax highlighting

---

### 4. **Advanced** - Everything

Perfect for: Documentation, technical writing

```tsx
import { RichTextAdvanced } from "@questpie/admin/client";

<RichTextAdvanced
  name="documentation"
  value={docs}
  onChange={setDocs}
  onImageUpload={handleImageUpload}
  showCharacterCount
/>;
```

**Features:**

- Everything in Standard
- Reserved for future advanced features (math, diagrams, etc.)

---

## Custom Configuration

### Using Presets with Overrides

Start with a preset and customize specific features:

```tsx
import { RichTextEditor } from "@questpie/admin/client";

<RichTextEditor
  preset="simple"
  features={{
    // Enable images in simple preset
    image: true,
    // Disable headings
    heading: false,
  }}
  onImageUpload={handleImageUpload}
/>;
```

### Manual Feature Configuration

For full control, configure features manually:

```tsx
<RichTextEditor
  features={{
    toolbar: true,
    bubbleMenu: true,
    bold: true,
    italic: true,
    underline: true,
    link: true,
    // ... other features
  }}
/>
```

## Image Upload

Enable image uploads by providing an upload handler:

```tsx
const handleImageUpload = async (file: File): Promise<string> => {
  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch("/api/upload", {
    method: "POST",
    body: formData,
  });

  const { url } = await response.json();
  return url;
};

<RichTextStandard
  onImageUpload={handleImageUpload}
  enableImages // Optional, defaults to true if onImageUpload provided
/>;
```

## Output Formats

The editor supports multiple output formats:

```tsx
// JSON (default) - Tiptap's native format
<RichTextEditor
  outputFormat="json"
  value={jsonContent}
  onChange={setJsonContent}
/>

// HTML - For display in frontend
<RichTextEditor
  outputFormat="html"
  value={htmlContent}
  onChange={setHtmlContent}
/>

// Markdown - For compatibility with other systems
<RichTextEditor
  outputFormat="markdown"
  value={markdownContent}
  onChange={setMarkdownContent}
/>
```

## Character Limits

Add character/word counting with optional limits:

```tsx
<RichTextSimple showCharacterCount maxCharacters={500} />
```

## Keyboard Shortcuts

Built-in keyboard shortcuts with visual hints in tooltips:

- **⌘B** - Bold
- **⌘I** - Italic
- **⌘U** - Underline
- **⌘E** - Code
- **⌘K** - Insert/edit link
- **⌘Z** - Undo
- **⌘⇧Z** - Redo

## Slash Commands

Type `/` to open the command menu:

- `/heading1`, `/heading2`, `/heading3` - Insert headings
- `/bulletlist` - Bullet list
- `/orderedlist` - Numbered list
- `/quote` - Blockquote
- `/code` - Code block
- `/table` - Insert table
- `/hr` - Horizontal rule

## Styling

The editor uses CSS classes for theming:

```css
.qp-rich-text-editor {
  /* Main container */
}

.qp-rich-text-editor__content {
  /* Editor content area */
}

.qp-rich-text-editor__slash {
  /* Slash command menu */
}

.qp-rich-text-editor__slash-item {
  /* Slash command item */
}

.qp-rich-text-editor__slash-item--active {
  /* Active slash command item */
}
```

## Advanced Usage

### Custom Extensions

Add custom Tiptap extensions:

```tsx
import { CustomExtension } from "./custom-extension";

<RichTextEditor extensions={[CustomExtension]} />;
```

### Read-only Mode

Disable editing:

```tsx
<RichTextEditor readOnly value={content} />
```

### Localization

All UI text is internationalized:

```tsx
<RichTextEditor
  localized
  locale="cs" // Czech
/>
```

## Architecture

The editor is split into focused modules:

- `index.tsx` - Main component (249 lines)
- `toolbar.tsx` - Icon-based toolbar
- `bubble-menu.tsx` - Selection menu
- `slash-commands.tsx` - Slash command system
- `link-popover.tsx` - Link dialog
- `image-popover.tsx` - Image upload
- `table-controls.tsx` - Table manipulation
- `extensions.tsx` - Tiptap configuration
- `presets.ts` - Feature presets
- `variants.tsx` - Convenience components
- `types.ts` - TypeScript definitions
- `utils.ts` - Helper functions

## Migration from Old API

The new preset system is backward compatible:

```tsx
// Old way (still works)
<RichTextEditor
  features={{
    bold: true,
    italic: true,
    // ... manual configuration
  }}
/>

// New way (recommended)
<RichTextSimple />
```

## Examples

### Blog Post Editor

```tsx
<RichTextSimple
  name="content"
  value={post.content}
  onChange={(content) => updatePost({ content })}
  placeholder="Write your post..."
  showCharacterCount
  maxCharacters={5000}
/>
```

### Comment System

```tsx
<RichTextMinimal
  name="comment"
  value={comment}
  onChange={setComment}
  placeholder="Add a comment..."
/>
```

### Documentation Editor

```tsx
<RichTextAdvanced
  name="docs"
  value={documentation}
  onChange={setDocumentation}
  onImageUpload={uploadToS3}
  showCharacterCount
/>
```

### Product Description

```tsx
<RichTextEditor
  preset="simple"
  features={{
    // Add images to simple preset
    image: true,
  }}
  onImageUpload={uploadProductImage}
  maxCharacters={1000}
  showCharacterCount
/>
```
