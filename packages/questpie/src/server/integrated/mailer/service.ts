import { render } from "@react-email/render";
import { convert } from "html-to-text";
import { ConsoleAdapter } from "./adapters/console.adapter.js";
import type { MailAdapter } from "./adapter.js";
import type {
  EmailTemplateDefinition,
  EmailTemplateNames,
  GetEmailTemplate,
  InferEmailTemplateContext,
} from "./template.js";
import type {
  MailOptions,
  MailerConfig,
  SerializableMailOptions,
} from "./types.js";

const isDev = process.env.NODE_ENV !== "production";

/**
 * Main mailer service
 */
export class MailerService<
  TTemplates extends Record<string, any> = Record<string, any>,
> {
  private templates: Map<string, EmailTemplateDefinition<any, any>>;
  private defaultFrom?: string;
  private defaultAdapter: MailAdapter | null = null;

  constructor(private config: MailerConfig<TTemplates>) {
    this.templates = new Map();
    if (config.templates) {
      for (const [_key, template] of Object.entries(config.templates)) {
        this.templates.set(template.name, template);
      }
    }
    this.defaultFrom = config.defaults?.from;
  }

  /**
   * Get the mail adapter, falling back to ConsoleAdapter in development
   */
  private async getAdapter(): Promise<MailAdapter> {
    const adapter = await this.config.adapter;
    if (adapter) {
      return adapter;
    }

    // In development, use ConsoleAdapter as default
    if (isDev) {
      if (!this.defaultAdapter) {
        this.defaultAdapter = new ConsoleAdapter();
      }
      return this.defaultAdapter;
    }

    throw new Error(
      "QUESTPIE: Email adapter is not configured. Provide adapter in .build({ email: { adapter: ... } })",
    );
  }

  /**
   * Serialize mail options (render React, convert to plain text)
   */
  private async serializeMailOptions({
    react,
    ...options
  }: MailOptions): Promise<SerializableMailOptions> {
    let html: string | undefined = options.html;
    let text: string | undefined = options.text;

    if (react) {
      html = await render(react);
      text ??= await render(react, { plainText: true });
    } else if (html && !text) {
      text = convert(html);
    }

    if (!html && !text) {
      throw new Error("No text or html provided");
    }

    return {
      ...options,
      from: options.from || this.defaultFrom || "noreply@example.com",
      text: text || "",
      html: html || "",
    };
  }

  /**
   * Send an email
   */
  async send(options: MailOptions): Promise<void> {
    const serializedMail = await this.serializeMailOptions(options);
    const adapter = await this.getAdapter();
    return adapter.send(serializedMail);
  }

  /**
   * Send an email using a defined template
   */
  async sendTemplate<K extends EmailTemplateNames<TTemplates>>(options: {
    template: K;
    context: InferEmailTemplateContext<GetEmailTemplate<TTemplates, K>>;
    to: string | string[];
    subject?: string;
    from?: string;
    cc?: string | string[];
    bcc?: string | string[];
  }): Promise<void> {
    const templateDef = this.templates.get(options.template as string);
    if (!templateDef) {
      throw new Error(`Template "${String(options.template)}" not found.`);
    }

    // Validate context with Zod schema
    const validatedContext = templateDef.schema.parse(options.context);

    // Render React component
    const RenderedComponent = templateDef.render;
    // @ts-expect-error - React types might mismatch slightly depending on env
    const element = RenderedComponent(validatedContext);

    // Use template's subject generator if subject not provided
    const subject =
      options.subject ||
      (templateDef.subject ? templateDef.subject(validatedContext) : undefined);

    if (!subject) {
      throw new Error(
        `Subject is required. Either provide 'subject' option or define 'subject' in template "${String(options.template)}"`,
      );
    }

    return this.send({
      to: options.to,
      subject,
      from: options.from,
      cc: options.cc,
      bcc: options.bcc,
      react: element,
    });
  }
}
