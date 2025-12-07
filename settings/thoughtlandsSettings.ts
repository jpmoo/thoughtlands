export type AIMode = 'openai' | 'local';

export interface ThoughtlandsSettings {
	aiMode: AIMode; // 'openai' or 'local'
	openAIApiKey: string;
	ollamaUrl: string; // URL for Ollama API (default: http://localhost:11434)
	ollamaEmbeddingModel: string; // Model name for embeddings (default: nomic-embed-text)
	ollamaChatModel: string; // Model name for chat/tag analysis (default: llama3.2 or similar)
	ignoredTags: string[];
	ignoredPaths: string[];
	includedPaths: string[]; // Folders to include (empty = all)
	includedTags: string[]; // Tags to include (empty = all)
	defaultColors: string[];
	aiModel: string; // OpenAI model (for backward compatibility)
	embeddingSimilarityThreshold: number; // 0-1, how similar notes need to be (default: 0.65)
	maxEmbeddingResults: number; // Max notes to find via embeddings (default: 20)
}

export const DEFAULT_SETTINGS: ThoughtlandsSettings = {
	aiMode: 'openai',
	openAIApiKey: '',
	ollamaUrl: 'http://localhost:11434',
	ollamaEmbeddingModel: 'nomic-embed-text',
	ollamaChatModel: 'llama3.2',
	ignoredTags: [],
	ignoredPaths: [],
	includedPaths: [],
	includedTags: [],
	defaultColors: ['#E67E22', '#3498DB', '#9B59B6', '#1ABC9C', '#E74C3C', '#F39C12', '#34495E', '#16A085'],
	aiModel: 'gpt-3.5-turbo',
	embeddingSimilarityThreshold: 0.65,
	maxEmbeddingResults: 20,
};

