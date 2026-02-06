/**
 * Search Providers
 *
 * Utility providers for search functionality (embeddings, etc.)
 */

export {
  CustomEmbeddingProvider,
  type CustomEmbeddingProviderOptions,
  createCustomEmbeddingProvider,
  createOpenAIEmbeddingProvider,
  OpenAIEmbeddingProvider,
  type OpenAIEmbeddingProviderOptions,
} from "./embeddings.js";
