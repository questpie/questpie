# Fix for Section 5: Email Templates

**Replace the current Section 5 with this corrected version:**

---

### 5. Email Templates (react-email)

```typescript
import { defineEmailTemplate, SmtpAdapter } from '@questpie/cms/server'
import { z } from 'zod'
import * as React from 'react'

// Define template with React (ComponentType, not JSX!)
const welcomeTemplate = defineEmailTemplate({
  name: 'welcome',
  schema: z.object({
    userName: z.string(),
    loginUrl: z.string(),
  }),
  render: ({ userName, loginUrl }) =>
    React.createElement(
      'div',
      null,
      React.createElement('h1', null, `Welcome ${userName}!`),
      React.createElement('p', null, 'Thanks for joining us.'),
      React.createElement('a', { href: loginUrl }, 'Login to your account'),
    ),
  subject: (ctx) => `Welcome ${ctx.userName}!`,
})

// Register template in CMS
export const cms = defineQCMS({ name: 'my-app' })
  .emailTemplates({ welcome: welcomeTemplate })
  .build({
    email: {
      adapter: new SmtpAdapter({
        transport: {
          host: process.env.SMTP_HOST,
          port: 587,
          auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        }
      }),
      defaults: { from: 'noreply@example.com' }
    }
  })
```

**Sending emails (3 ways):**

```typescript
// 1. Send plain HTML email
await cms.email.send({
  to: 'user@example.com',
  subject: 'Welcome!',
  html: '<h1>Hello World</h1>',
  text: 'Hello World',  // optional plain-text version
})

// 2. Send with React element (inline)
await cms.email.send({
  to: 'user@example.com',
  subject: 'Welcome!',
  react: React.createElement('div', null,
    React.createElement('h1', null, 'Hello!')
  ),
})

// 3. Send using registered template (type-safe!)
await cms.email.sendTemplate({
  template: 'welcome',  // ✓ Autocomplete knows registered templates
  context: {
    userName: 'John',   // ✓ Type-safe context matching schema
    loginUrl: 'https://example.com/login'
  },
  to: 'user@example.com',
  subject: 'Custom subject',  // Optional - uses template's subject() if omitted
})
```

**What this gives you:**
- Define email templates with React (works with @react-email/components)
- Automatic HTML + plain-text rendering via @react-email/render
- Type-safe template schemas with Zod
- Multiple adapters: SMTP, Console (dev), or custom
- Template registry with autocomplete for template names and context

---

**Key points:**
1. Template `render` is a **function** that returns React.createElement(), not JSX
2. `send()` accepts either `html`/`text` OR `react`, not both
3. `sendTemplate()` is separate method for using registered templates
4. Templates are validated with Zod schemas at send-time
