/**
 * Embedding Providers
 *
 * Utilities for generating embeddings for semantic search.
 * Used by adapters that support semantic/vector search (e.g., PgVectorSearchAdapter).
 */

import type { EmbeddingProvider } from "../types.js";

// ============================================================================
// OpenAI Embedding Provider
// ============================================================================

export interface OpenAIEmbeddingProviderOptions {
  /**
   * OpenAI API key
   */
  apiKey: string;

  /**
   * Model name
   * @default "text-embedding-3-small"
   */
  model?: string;

  /**
   * Embedding dimensions (model-specific)
   * - text-embedding-3-small: 1536 (default) or 512
   * - text-embedding-3-large: 3072 (default) or 256, 1024
   * - text-embedding-ada-002: 1536 (fixed)
   * @default 1536
   */
  dimensions?: number;

  /**
   * OpenAI API base URL (for proxies/compatible APIs)
   * @default "https://api.openai.com/v1"
   */
  baseUrl?: string;
}

/**
 * OpenAI Embedding Provider
 *
 * Uses OpenAI's embedding API to generate vectors.
 *
 * @example
 * ```ts
 * const provider = createOpenAIEmbeddingProvider({
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: "text-embedding-3-small",
 * });
 *
 * const embedding = await provider.generate("Hello world");
 * ```
 */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly model: string;
  readonly dimensions: number;

  private apiKey: string;
  private baseUrl: string;

  constructor(options: OpenAIEmbeddingProviderOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? "text-embedding-3-small";
    this.dimensions = options.dimensions ?? 1536;
    this.baseUrl = options.baseUrl ?? "https://api.openai.com/v1";
  }

  async generate(text: string): Promise<number[]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding failed: ${response.status} ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[] }>;
    };
    return data.data[0].embedding;
  }

  async generateBatch(texts: string[]): Promise<number[][]> {
    const response = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: texts,
        dimensions: this.dimensions,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`OpenAI embedding failed: ${response.status} ${error}`);
    }

    const data = (await response.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };

    // Sort by index to maintain order
    return data.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  }
}

/**
 * Create OpenAI embedding provider
 */
export function createOpenAIEmbeddingProvider(
  options: OpenAIEmbeddingProviderOptions,
): OpenAIEmbeddingProvider {
  return new OpenAIEmbeddingProvider(options);
}

// ============================================================================
// Custom Embedding Provider
// ============================================================================

export interface CustomEmbeddingProviderOptions {
  /**
   * Provider name for logging
   */
  name: string;

  /**
   * Model identifier
   */
  model: string;

  /**
   * Embedding dimensions
   */
  dimensions: number;

  /**
   * Function to generate embedding for single text
   */
  generate: (text: string) => Promise<number[]>;

  /**
   * Optional function to generate embeddings for batch of texts
   * If not provided, will call generate() for each text
   */
  generateBatch?: (texts: string[]) => Promise<number[][]>;
}

/**
 * Custom Embedding Provider
 *
 * Allows using any embedding service/model by providing custom functions.
 *
 * @example
 * ```ts
 * const provider = createCustomEmbeddingProvider({
 *   name: "local",
 *   model: "all-MiniLM-L6-v2",
 *   dimensions: 384,
 *   generate: async (text) => {
 *     // Call local model
 *     return myLocalModel.embed(text);
 *   },
 * });
 * ```
 */
export class CustomEmbeddingProvider implements EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimensions: number;

  private generateFn: (text: string) => Promise<number[]>;
  private generateBatchFn?: (texts: string[]) => Promise<number[][]>;

  constructor(options: CustomEmbeddingProviderOptions) {
    this.name = options.name;
    this.model = options.model;
    this.dimensions = options.dimensions;
    this.generateFn = options.generate;
    this.generateBatchFn = options.generateBatch;
  }

  async generate(text: string): Promise<number[]> {
    return this.generateFn(text);
  }

  async generateBatch(texts: string[]): Promise<number[][]> {
    if (this.generateBatchFn) {
      return this.generateBatchFn(texts);
    }
    // Fallback: generate one by one
    return Promise.all(texts.map((text) => this.generate(text)));
  }
}

/**
 * Create custom embedding provider
 */
export function createCustomEmbeddingProvider(
  options: CustomEmbeddingProviderOptions,
): CustomEmbeddingProvider {
  return new CustomEmbeddingProvider(options);
}

// ============================================================================
// Future Providers (TODO)
// ============================================================================

/**
 * TODO: CohereEmbeddingProvider
 *
 * Uses Cohere's embedding API.
 * Models: embed-english-v3.0, embed-multilingual-v3.0
 */

/**
 * TODO: VoyageEmbeddingProvider
 *
 * Uses Voyage AI's embedding API.
 * Known for high-quality embeddings.
 */

/**
 * TODO: OllamaEmbeddingProvider
 *
 * Uses local Ollama for embeddings.
 * Models: nomic-embed-text, all-minilm, etc.
 */

/**
 * TODO: HuggingFaceEmbeddingProvider
 *
 * Uses HuggingFace Inference API or local transformers.js.
 */
