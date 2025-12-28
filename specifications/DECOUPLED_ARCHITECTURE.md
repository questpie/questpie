## Questpie CMS - Decoupled Architecture Specification

This document outlines the architectural principle of separating the backend data schema definitions from their respective administrative user interface (UI) configurations. This approach is fundamental for supporting AI-driven rapid application development, customizability for agencies, and multi-platform client applications (web, mobile).

### 1. Backend Core (`packages/core`)

**Purpose:** To define the canonical data model (collections, fields, relations) and core business logic (auth, storage, queues, custom API endpoints) independent of any specific UI.

**Key Characteristics:**
-   **Technology:** ElysiaJS, Drizzle ORM, TypeScript.
-   **Schema Definition:** Uses a fluent `collection()` builder pattern (e.g., `collection('posts').fields(...)`).
-   **UI Agnostic:** Contains no UI-specific properties (e.g., `label` for a form field, `component` type, `admin.position`, `admin.width`).
-   **Modules:** Collections and related logic are bundled into `Modules` using `defineModule` (e.g., `BarbershopModule`). These modules represent reusable backend feature sets.
-   **API:** Automatically generates RESTful API endpoints based on collection definitions.
-   **Access Control:** Backend is responsible for defining and enforcing access control for data operations.

**Example (from `packages/core/src/modules/barbershop/schema.ts`):
```typescript
import { defineCollection } from '../../server/collection/builder/collection-builder';

export const services = defineCollection('services')
  .fields((f) => ({
    name: f.text().required(),
    price: f.integer().required(),
    durationMinutes: f.integer().default(30),
    description: f.text()
  }));

// ... other collections (barbers, appointments)
```

### 2. Administrative User Interface (UI) Layer (`apps/tanstackstart-admin`)

**Purpose:** To consume the backend data models and provide a flexible, configurable, and AI-editable administrative interface for managing that data.

**Key Characteristics:**
-   **Technology:** React (TanStack Start), Tailwind CSS, Shadcn UI.
-   **Configuration-Driven:** The admin UI is rendered dynamically based on explicit configuration files that reference the backend modules/collections.
-   **UI-Specific Properties:** Configuration includes properties like `label`, `description`, `component` mapping (e.g., `CurrencyInput`, `RichTextEditor`), `admin.position` (main, sidebar), custom list views (`overrideListView`), and table column definitions.
-   **Decoupled:** The admin configuration lives entirely within the frontend application and has no direct impact on the backend's data model or logic.
-   **AI Editability:** This layer is the primary target for AI agents making UI-related modifications, as changes here do not risk backend data integrity.
-   **Extensibility:** Allows for easy swapping of UI components or entire views to support client-specific branding or workflows.

**Example (Conceptual `apps/tanstackstart-admin/src/configs/barbershop.admin.ts`):
```typescript
import { BarbershopModule } from '@qcms/core/modules/barbershop';
import { CalendarView } from '@/components/views/CalendarView';
import { CurrencyInput } from '@/components/inputs/CurrencyInput';
import { defineAdminConfig } from '@/lib/admin-config'; // Hypothetical helper

export const barbershopAdminConfig = defineAdminConfig({
  module: BarbershopModule, // Link to the backend module
  
  resources: {
    services: {
      list: {
        columns: ['name', 'price', 'durationMinutes']
      },
      fields: {
        price: {
          label: 'Service Price',
          component: <CurrencyInput currency="EUR" /> // UI Component mapping
        },
        // ... other service fields
      }
    },

    appointments: {
      overrideListView: <CalendarView 
        groupBy="barber" 
        timeStart="09:00" 
        timeEnd="18:00" 
      />
    }
  }
});
```

### 3. AI Agent Interaction

-   **Structured Commands (for Backend/Core):** AI will primarily use well-defined CLI tools (e.g., `questpie create-module`, `questpie add-field-to-collection`) that leverage AST manipulation for safe, programmatic changes to `packages/core` schema files.
-   **Direct Editing (for Frontend/Admin):** For UI-specific customizations, AI agents will directly modify the Admin UI Layer's configuration files (e.g., `barbershop.admin.ts`) or even custom React components. Due to the decoupled nature, these changes are isolated and less risky to core data integrity.

### Benefits

-   **Safety:** AI changes to the UI layer do not impact the core data model, reducing the risk of data corruption.
-   **Flexibility:** Agencies can easily swap out entire UI frameworks or components while retaining the same backend.
-   **Rapid Development:** AI can quickly scaffold and customize both backend modules and their respective admin UIs.
-   **Multi-Platform Support:** The same backend module can serve multiple client applications (web admin, mobile app, public API).

This decoupled approach ensures that Questpie CMS is not just a CMS, but a powerful, AI-native application generation platform for developers and agencies.
