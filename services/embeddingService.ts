import { App, TFile, Notice } from 'obsidian';
import { ThoughtlandsSettings } from '../settings/thoughtlandsSettings';
import { EmbeddingStorageService } from './embeddingStorageService';

export interface EmbeddingStatus {
	available: boolean;
	modelInstalled: boolean;
	modelName: string;
	error?: string;
}

export interface EmbeddingResult {
	embedding: number[];
	file: TFile;
}

export interface EmbeddingProgress {
	total: number;
	completed: number;
	current: number;
	percentage: number;
	currentFile?: string;
}

export class EmbeddingService {
	private app: App;
	private settings: ThoughtlandsSettings;
	private embeddingCache: Map<string, number[]> = new Map();
	private storageService: EmbeddingStorageService;
	private isProcessing: boolean = false;
	private currentProgress: EmbeddingProgress | null = null;
	private progressCallbacks: Set<(progress: EmbeddingProgress) => void> = new Set();
	private filesGeneratingEmbeddings: Set<string> = new Set(); // Track files currently generating embeddings

	constructor(app: App, settings: ThoughtlandsSettings, plugin: any) {
		this.app = app;
		this.settings = settings;
		this.storageService = new EmbeddingStorageService(app, plugin);
	}

	updateSettings(newSettings: ThoughtlandsSettings): void {
		this.settings = newSettings;
		// Clear cache when settings change
		this.embeddingCache.clear();
	}

	onProgress(callback: (progress: EmbeddingProgress) => void): () => void {
		this.progressCallbacks.add(callback);
		return () => {
			this.progressCallbacks.delete(callback);
		};
	}

	private notifyProgress(progress: EmbeddingProgress): void {
		this.currentProgress = progress;
		for (const callback of this.progressCallbacks) {
			callback(progress);
		}
	}

	getCurrentProgress(): EmbeddingProgress | null {
		return this.currentProgress;
	}

	isEmbeddingProcessComplete(): boolean {
		// Check if embeddings data is loaded and has lastFullBuild set
		const data = this.storageService.getEmbeddingsData();
		if (!data) {
			return false;
		}
		const hasLastFullBuild = data.meta && data.meta.lastFullBuild !== null && data.meta.lastFullBuild !== undefined;
		// Only log if there's an issue (data exists but no lastFullBuild)
		if (data && data.meta && !hasLastFullBuild) {
			console.log('[Thoughtlands:EmbeddingService] Embeddings data exists but initial build not completed');
		}
		return hasLastFullBuild;
	}

	isEmbeddingProcessInProgress(): boolean {
		return this.isProcessing;
	}

	async checkOllamaStatus(): Promise<EmbeddingStatus> {
		try {
			// Check if Ollama is running and model is available
			const response = await fetch(`${this.settings.ollamaUrl}/api/tags`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
			});

			if (!response.ok) {
				return {
					available: false,
					modelInstalled: false,
					modelName: this.settings.ollamaEmbeddingModel,
					error: `Ollama not responding (${response.status})`,
				};
			}

			const data = await response.json();
			const models = data.models || [];
			
			// Log available models for debugging
			console.log('[Thoughtlands:EmbeddingService] Available Ollama models:', models.map((m: any) => m.name));
			console.log('[Thoughtlands:EmbeddingService] Looking for model:', this.settings.ollamaEmbeddingModel);
			
			// Check if model is installed - model names might include tags like "nomic-embed-text:latest"
			// or just "nomic-embed-text", so we check if the model name starts with our target model name
			const modelInstalled = models.some((m: any) => {
				const modelName = m.name || '';
				// Check exact match or if model name starts with our target (handles tags like :latest, :v1, etc.)
				const matches = modelName === this.settings.ollamaEmbeddingModel || 
				               modelName.startsWith(this.settings.ollamaEmbeddingModel + ':') ||
				               modelName.startsWith(this.settings.ollamaEmbeddingModel + '@');
				if (matches) {
					console.log(`[Thoughtlands:EmbeddingService] Found matching model: "${modelName}"`);
				}
				return matches;
			});

			// Also check if /api/embed or /api/embeddings endpoint is available
			let embedEndpointAvailable = false;
			if (modelInstalled) {
				try {
					// Try /api/embed first
					let embedTest = await fetch(`${this.settings.ollamaUrl}/api/embed`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							model: this.settings.ollamaEmbeddingModel,
							input: 'test', // Ollama uses "input" not "prompt" for embeddings
						}),
					});
					
					// If 404/405, try /api/embeddings
					if (!embedTest.ok && (embedTest.status === 404 || embedTest.status === 405)) {
						console.log('[Thoughtlands:EmbeddingService] /api/embed not available, trying /api/embeddings');
						embedTest = await fetch(`${this.settings.ollamaUrl}/api/embeddings`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
							},
							body: JSON.stringify({
								model: this.settings.ollamaEmbeddingModel,
								input: 'test', // Ollama uses "input" not "prompt" for embeddings
							}),
						});
					}
					
					embedEndpointAvailable = embedTest.ok;
					if (!embedTest.ok) {
						console.warn('[Thoughtlands:EmbeddingService] Embedding endpoint returned:', embedTest.status);
					}
				} catch (testError) {
					console.warn('[Thoughtlands:EmbeddingService] Error testing embedding endpoint:', testError);
				}
			}

			return {
				available: true,
				modelInstalled: modelInstalled && embedEndpointAvailable,
				modelName: this.settings.ollamaEmbeddingModel,
				error: !modelInstalled 
					? `Model "${this.settings.ollamaEmbeddingModel}" not found in Ollama`
					: !embedEndpointAvailable
					? `Model found but /api/embed endpoint not available (may need Ollama update)`
					: undefined,
			};
		} catch (error) {
			return {
				available: false,
				modelInstalled: false,
				modelName: this.settings.ollamaEmbeddingModel,
				error: error instanceof Error ? error.message : 'Failed to connect to Ollama',
			};
		}
	}

	async generateEmbedding(text: string): Promise<number[]> {
		// Validate input
		if (!text || text.trim().length === 0) {
			throw new Error('Cannot generate embedding for empty text');
		}

		// Check cache first
		const cacheKey = text.substring(0, 100); // Use first 100 chars as cache key
		if (this.embeddingCache.has(cacheKey)) {
			return this.embeddingCache.get(cacheKey)!;
		}

		// Retry logic for transient errors
		const maxRetries = 3;
		let lastError: Error | null = null;
		
		for (let attempt = 0; attempt <= maxRetries; attempt++) {
			try {
				// Log the request details (only on first attempt)
				if (attempt === 0) {
					console.log(`[Thoughtlands:EmbeddingService] Sending embedding request:`, {
						url: `${this.settings.ollamaUrl}/api/embed`,
						model: this.settings.ollamaEmbeddingModel,
						textLength: text.length,
						textPreview: text.substring(0, 100)
					});
				} else {
					console.log(`[Thoughtlands:EmbeddingService] Retry attempt ${attempt}/${maxRetries} for embedding request`);
				}
				
				const requestBody = {
					model: this.settings.ollamaEmbeddingModel,
					input: text, // Ollama uses "input" not "prompt" for embeddings
				};
				
				// Try /api/embed first, then fallback to /api/embeddings if needed
				let response: Response;
				try {
					// Add timeout to prevent hanging (30 seconds)
					const controller = new AbortController();
					const timeoutId = setTimeout(() => controller.abort(), 30000);
					
					try {
						response = await fetch(`${this.settings.ollamaUrl}/api/embed`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(requestBody),
							signal: controller.signal,
				});
						clearTimeout(timeoutId);
					} catch (fetchError) {
						clearTimeout(timeoutId);
						if (fetchError instanceof Error && fetchError.name === 'AbortError') {
							throw new Error('Request timeout after 30 seconds');
						}
						throw fetchError;
					}

				// If 404/405, try /api/embeddings (plural) as fallback
				if (!response.ok && (response.status === 404 || response.status === 405)) {
					console.log('[Thoughtlands:EmbeddingService] /api/embed failed, trying /api/embeddings');
						try {
							// Add timeout for fallback request too
							const fallbackController = new AbortController();
							const fallbackTimeoutId = setTimeout(() => fallbackController.abort(), 30000);
							
							try {
					response = await fetch(`${this.settings.ollamaUrl}/api/embeddings`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							model: this.settings.ollamaEmbeddingModel,
							input: text, // Ollama uses "input" not "prompt" for embeddings
						}),
									signal: fallbackController.signal,
					});
								clearTimeout(fallbackTimeoutId);
							} catch (fallbackFetchError) {
								clearTimeout(fallbackTimeoutId);
								if (fallbackFetchError instanceof Error && fallbackFetchError.name === 'AbortError') {
									throw new Error('Fallback request timeout after 30 seconds');
								}
								throw fallbackFetchError;
							}
						} catch (fallbackError) {
							// If fallback fetch throws, use the original response for error reporting
							console.error('[Thoughtlands:EmbeddingService] Fallback fetch failed:', fallbackError);
							// Re-throw as a more descriptive error
							throw new Error(`Failed to connect to Ollama embedding endpoint: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}`);
						}
					}
				} catch (fetchError) {
					// Network error or other fetch failure
					const error = new Error(`Failed to connect to Ollama: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}`);
					(error as any).retryable = true; // Network errors are retryable
					if (attempt < maxRetries) {
						const delay = Math.min(1000 * Math.pow(2, attempt), 5000);
						console.warn(`[Thoughtlands:EmbeddingService] Network error, waiting ${delay}ms before retry...`);
						await new Promise(resolve => setTimeout(resolve, delay));
						lastError = error;
						continue; // Retry
					}
					throw error;
				}

				if (!response.ok) {
					let errorText = '';
					try {
						errorText = await response.text();
					} catch (textError) {
						errorText = `Unable to read error response: ${textError instanceof Error ? textError.message : 'Unknown error'}`;
					}
					const error = new Error(`Ollama API error: ${response.status} - ${errorText}`);
					// Mark as retryable for 500 errors (server issues) or connection errors
					const isRetryable = response.status === 500 || response.status >= 502;
					(error as any).retryable = isRetryable;
					
					// If retryable and we have retries left, wait and retry
					if (isRetryable && attempt < maxRetries) {
						const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // Exponential backoff, max 5s
						console.warn(`[Thoughtlands:EmbeddingService] Retryable error, waiting ${delay}ms before retry...`);
						await new Promise(resolve => setTimeout(resolve, delay));
						lastError = error;
						continue; // Retry
					}
					
					throw error;
				}
				
				// Success - break out of retry loop
				lastError = null;

			const data = await response.json();
			
				// Log the response structure
				console.log(`[Thoughtlands:EmbeddingService] Received embedding response:`, {
				status: response.status,
				hasEmbedding: !!data.embedding,
				hasEmbeddings: !!data.embeddings,
				keys: Object.keys(data),
				embeddingType: Array.isArray(data.embedding) ? 'array' : typeof data.embedding,
				embeddingsType: Array.isArray(data.embeddings) ? 'array' : typeof data.embeddings,
				embeddingsLength: Array.isArray(data.embeddings) ? data.embeddings.length : 0,
				embeddingLength: Array.isArray(data.embedding) ? data.embedding.length : 'N/A',
				model: data.model
			});
			
				// Ollama may return 'embedding' (singular) or 'embeddings' (plural) array
				let embedding: number[] | undefined;
				if (data.embedding) {
					embedding = Array.isArray(data.embedding) ? data.embedding : undefined;
				} else if (data.embeddings && Array.isArray(data.embeddings)) {
					// If it's an array, take the first element
					embedding = data.embeddings[0] || undefined;
				}
				
				if (!embedding || embedding.length === 0) {
					// Check if model needs to be pulled/loaded
					if (data.model && data.embeddings && Array.isArray(data.embeddings) && data.embeddings.length === 0) {
						console.warn(`[Thoughtlands:EmbeddingService] Model "${data.model}" returned empty embeddings. This may indicate the model needs to be pulled or loaded. Try running: ollama pull ${this.settings.ollamaEmbeddingModel}`);
					}
					
					// Log detailed error information
					console.error('[Thoughtlands:EmbeddingService] Invalid embedding response:', {
						hasEmbedding: !!data.embedding,
						hasEmbeddings: !!data.embeddings,
						keys: Object.keys(data),
						embeddingType: Array.isArray(data.embedding) ? 'array' : typeof data.embedding,
						embeddingsType: Array.isArray(data.embeddings) ? 'array' : typeof data.embeddings,
						embeddingsLength: Array.isArray(data.embeddings) ? data.embeddings.length : 0,
						textLength: text.length,
						textPreview: text.substring(0, 100),
						fullResponse: JSON.stringify(data)
					});
					throw new Error(`Invalid embedding response: ${JSON.stringify(data)}. This may indicate the model is not properly loaded. Try running: ollama pull ${this.settings.ollamaEmbeddingModel}`);
				}

				// Cache the result
				this.embeddingCache.set(cacheKey, embedding);

				return embedding;
			} catch (error: any) {
				lastError = error;
				// If it's retryable and we have retries left, continue the loop
				if (error.retryable && attempt < maxRetries) {
					const delay = Math.min(1000 * Math.pow(2, attempt), 5000); // Exponential backoff, max 5s
					console.warn(`[Thoughtlands:EmbeddingService] Retryable error (${error.message}), waiting ${delay}ms before retry...`);
					await new Promise(resolve => setTimeout(resolve, delay));
					continue;
				}
				// Not retryable or out of retries - throw
				console.error('[Thoughtlands:EmbeddingService] Error generating embedding:', error);
				throw error;
			}
		}
		
		// If we get here, all retries failed
		if (lastError) {
			throw lastError;
		}
		throw new Error('Failed to generate embedding after retries');
	}

	async generateEmbeddingForFile(file: TFile): Promise<number[]> {
		// Check storage first
		const storedEmbedding = await this.storageService.getEmbedding(file);
		if (storedEmbedding) {
			return storedEmbedding;
		}

		// Prevent duplicate processing - check if file is already being processed
		if (this.filesGeneratingEmbeddings.has(file.path)) {
			console.log(`[Thoughtlands:EmbeddingService] ${file.path} is already generating embedding, skipping duplicate request`);
			// Wait a bit and check storage again (in case the other process finished)
			await new Promise(resolve => setTimeout(resolve, 100));
			const retryEmbedding = await this.storageService.getEmbedding(file);
			if (retryEmbedding) {
				return retryEmbedding;
			}
			// If still not found, throw error to indicate it's being processed
			throw new Error(`Embedding generation already in progress for ${file.path}`);
		}

		// Mark as generating
		this.filesGeneratingEmbeddings.add(file.path);

		try {
			const content = await this.app.vault.read(file);
			// Use first 2000 characters for embedding (models have token limits)
			const text = content.substring(0, 2000).trim();
			
			// Log file details for debugging
			console.log(`[Thoughtlands:EmbeddingService] Processing file: ${file.path}`, {
				fullContentLength: content.length,
				textLength: text.length,
				textPreview: text.substring(0, 200),
				hasContent: !!content,
				hasText: !!text
			});
			
			// Skip empty files
			if (!text || text.length === 0) {
				console.warn(`[Thoughtlands:EmbeddingService] Skipping empty file: ${file.path}`);
				return [];
			}
			
			// Skip very short files (likely just metadata or headers)
			if (text.length < 10) {
				console.warn(`[Thoughtlands:EmbeddingService] Skipping very short file: ${file.path} (${text.length} chars)`);
				return [];
			}
			
			try {
				const embedding = await this.generateEmbedding(text);
				
				// Store the embedding
				const hash = await this.storageService.computeHash(file);
				const updates = new Map<TFile, { hash: string; embedding: number[] }>();
				updates.set(file, { hash, embedding });
				await this.storageService.updateEmbeddings(updates);
				
				return embedding;
			} catch (error: any) {
				// If it's an empty embedding error, log and skip (don't throw)
				if (error.message && error.message.includes('Invalid embedding response')) {
					console.warn(`[Thoughtlands:EmbeddingService] Skipping file with empty embedding response: ${file.path}. This may indicate the file is too short or the model needs to be reloaded.`);
					return [];
				}
				// For other errors, re-throw
				throw error;
			}
		} catch (error) {
			console.error(`[Thoughtlands:EmbeddingService] Error generating embedding for ${file.path}:`, error);
			throw error;
		} finally {
			// Always remove from generating set
			this.filesGeneratingEmbeddings.delete(file.path);
		}
	}

	async generateEmbeddingsBatch(files: TFile[]): Promise<Map<TFile, number[]>> {
		const results = new Map<TFile, number[]>();
		
		if (files.length === 0) {
			return results;
		}

		// Process files with throttling to avoid overwhelming Ollama
		// Limit to 1 concurrent request to prevent crashes (Ollama is very sensitive)
		const CONCURRENT_LIMIT = 1;
		console.log(`[Thoughtlands:EmbeddingService] Generating embeddings for ${files.length} files (max ${CONCURRENT_LIMIT} concurrent)`);
		
		try {
			// Process files in batches to limit concurrency
			for (let i = 0; i < files.length; i += CONCURRENT_LIMIT) {
				const batch = files.slice(i, i + CONCURRENT_LIMIT);
				const batchPromises = batch.map(async (file) => {
				try {
					const content = await this.app.vault.read(file);
					const text = content.substring(0, 2000);
					
					if (!text || text.trim().length === 0) {
						console.warn(`[Thoughtlands:EmbeddingService] Empty content for ${file.path}`);
						return null;
					}

					// Try /api/embed first, then fallback to /api/embeddings if needed
					let response: Response;
					try {
						response = await fetch(`${this.settings.ollamaUrl}/api/embed`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							model: this.settings.ollamaEmbeddingModel,
							input: text, // Ollama uses "input" not "prompt" for embeddings
						}),
					});

					// If 404/405, try /api/embeddings (plural) as fallback
					if (!response.ok && (response.status === 404 || response.status === 405)) {
						console.log(`[Thoughtlands:EmbeddingService] /api/embed failed for ${file.path}, trying /api/embeddings`);
							try {
						response = await fetch(`${this.settings.ollamaUrl}/api/embeddings`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
							},
							body: JSON.stringify({
								model: this.settings.ollamaEmbeddingModel,
								input: text, // Ollama uses "input" not "prompt" for embeddings
							}),
						});
							} catch (fallbackError) {
								console.error(`[Thoughtlands:EmbeddingService] Fallback fetch failed for ${file.path}:`, fallbackError);
								return null;
							}
						}
					} catch (fetchError) {
						console.error(`[Thoughtlands:EmbeddingService] Network error for ${file.path}:`, fetchError);
						return null;
					}

					if (!response.ok) {
						let errorText = '';
						try {
							errorText = await response.text();
						} catch (textError) {
							errorText = `Unable to read error response: ${textError instanceof Error ? textError.message : 'Unknown error'}`;
						}
						console.error(`[Thoughtlands:EmbeddingService] Error for ${file.path}:`, {
							status: response.status,
							error: errorText
						});
						return null;
					}

					const data = await response.json();
					
					// Ollama may return 'embedding' (singular) or 'embeddings' (plural) array
					let embedding: number[] | undefined;
					if (data.embedding) {
						embedding = Array.isArray(data.embedding) ? data.embedding : undefined;
					} else if (data.embeddings && Array.isArray(data.embeddings)) {
						// If it's an array, take the first element
						embedding = data.embeddings[0] || undefined;
					}
					
					if (!embedding || embedding.length === 0) {
						console.error(`[Thoughtlands:EmbeddingService] Invalid embedding for ${file.path}:`, {
							hasEmbedding: !!data.embedding,
							hasEmbeddings: !!data.embeddings,
							embeddingsLength: Array.isArray(data.embeddings) ? data.embeddings.length : 0,
							dataKeys: Object.keys(data),
							textLength: text.length,
							textPreview: text.substring(0, 100),
							fullResponse: JSON.stringify(data),
							dataSample: data
						});
						return null;
					}

					// Verify all elements are numbers
					if (!embedding.every((val: any) => typeof val === 'number')) {
						console.warn(`[Thoughtlands:EmbeddingService] Embedding contains non-numeric values for ${file.path}`);
						return null;
					}

					return { file, embedding };
				} catch (error) {
					console.error(`[Thoughtlands:EmbeddingService] Exception generating embedding for ${file.path}:`, error);
					return null;
				}
				});

				const batchResults = await Promise.all(batchPromises);
				
				// Store embeddings from this batch
				const updates = new Map<TFile, { hash: string; embedding: number[] }>();
				
				for (const result of batchResults) {
					if (!result) continue;
					
					const { file, embedding } = result;
					results.set(file, embedding);
					
					const hash = await this.storageService.computeHash(file);
					updates.set(file, { hash, embedding });
				}
				
				if (updates.size > 0) {
					await this.storageService.updateEmbeddings(updates);
				}
				
				// Delay between batches to avoid overwhelming Ollama
				// Since we're processing 1 at a time, add a small delay between each file
				if (i + CONCURRENT_LIMIT < files.length) {
					await new Promise(resolve => setTimeout(resolve, 200)); // 200ms delay between files
				}
			}
			
			return results;
		} catch (error) {
			console.error('[Thoughtlands:EmbeddingService] Error generating batch embeddings:', error);
			throw error;
		}
	}

	async generateInitialEmbeddings(
		allFiles: TFile[],
		onProgress?: (progress: EmbeddingProgress) => void
	): Promise<void> {
		if (this.isProcessing) {
			throw new Error('Embedding process already in progress');
		}

		this.isProcessing = true;
		
		try {
			// Load existing embeddings
			await this.storageService.loadEmbeddings();
			
			// Get files that need embeddings
			const missingFiles = await this.storageService.getMissingFiles(allFiles);
			const total = missingFiles.length;
			
			console.log(`[Thoughtlands:EmbeddingService] Starting initial embedding process for ${total} files`);
			
			if (total === 0) {
				// All files have embeddings, mark as complete
				await this.storageService.markFullBuildComplete(this.settings.ollamaEmbeddingModel);
				this.notifyProgress({
					total: allFiles.length,
					completed: allFiles.length,
					current: allFiles.length,
					percentage: 100,
				});
				this.isProcessing = false;
				return;
			}
			
			// Process in batches of 15 (middle of 10-20 range)
			const batchSize = 15;
			let completed = 0;
			
			for (let i = 0; i < missingFiles.length; i += batchSize) {
				const batch = missingFiles.slice(i, i + batchSize);
				const batchNum = Math.floor(i / batchSize) + 1;
				const totalBatches = Math.ceil(missingFiles.length / batchSize);
				
				console.log(`[Thoughtlands:EmbeddingService] Processing batch ${batchNum}/${totalBatches} (${batch.length} files)`);
				
				// Update progress for current batch
				for (const file of batch) {
					completed++;
					const progress: EmbeddingProgress = {
						total: total,
						completed: completed,
						current: completed,
						percentage: Math.round((completed / total) * 100),
						currentFile: file.path,
					};
					this.notifyProgress(progress);
					if (onProgress) {
						onProgress(progress);
					}
				}
				
				// Generate embeddings for batch
				await this.generateEmbeddingsBatch(batch);
				
				// Throttle to prevent UI blocking (300ms between batches)
				if (i + batchSize < missingFiles.length) {
					await new Promise(resolve => setTimeout(resolve, 300));
				}
			}
			
			// Mark full build as complete
			await this.storageService.markFullBuildComplete(this.settings.ollamaEmbeddingModel);
			
			console.log(`[Thoughtlands:EmbeddingService] Initial embedding process complete for ${total} files`);
			
			this.notifyProgress({
				total: total,
				completed: total,
				current: total,
				percentage: 100,
			});
		} catch (error) {
			console.error('[Thoughtlands:EmbeddingService] Error in initial embedding process:', error);
			throw error;
		} finally {
			this.isProcessing = false;
		}
	}

	getStorageService(): EmbeddingStorageService {
		return this.storageService;
	}

	calculateCentroid(embeddings: number[][]): number[] {
		if (embeddings.length === 0) {
			return [];
		}

		const dimension = embeddings[0].length;
		const centroid = new Array(dimension).fill(0);

		for (const embedding of embeddings) {
			for (let i = 0; i < dimension; i++) {
				centroid[i] += embedding[i];
			}
		}

		// Average
		for (let i = 0; i < dimension; i++) {
			centroid[i] /= embeddings.length;
		}

		return centroid;
	}

	cosineSimilarity(vec1: number[], vec2: number[]): number {
		if (vec1.length !== vec2.length) {
			throw new Error('Vectors must have the same dimension');
		}

		let dotProduct = 0;
		let norm1 = 0;
		let norm2 = 0;

		for (let i = 0; i < vec1.length; i++) {
			dotProduct += vec1[i] * vec2[i];
			norm1 += vec1[i] * vec1[i];
			norm2 += vec2[i] * vec2[i];
		}

		const denominator = Math.sqrt(norm1) * Math.sqrt(norm2);
		if (denominator === 0) {
			return 0;
		}

		return dotProduct / denominator;
	}

	async findSimilarNotes(
		centroid: number[],
		candidateFiles: TFile[],
		excludeFiles: TFile[],
		maxResults: number = 20
	): Promise<{ file: TFile; similarity: number }[]> {
		const excludePaths = new Set(excludeFiles.map(f => f.path));
		const results: { file: TFile; similarity: number }[] = [];

		console.log(`[Thoughtlands:EmbeddingService] Finding similar notes from ${candidateFiles.length} candidates, excluding ${excludeFiles.length} files`);

		// Only check files that already have embeddings - don't generate new ones on the fly
		// This prevents 500 errors from trying to generate embeddings for too many files at once
		const filesWithEmbeddings: TFile[] = [];
		for (const file of candidateFiles) {
			if (excludePaths.has(file.path)) {
				continue;
			}
			// Check if file already has an embedding
			const hasEmbedding = await this.storageService.hasEmbedding(file);
			if (hasEmbedding) {
				filesWithEmbeddings.push(file);
			}
		}

		console.log(`[Thoughtlands:EmbeddingService] Found ${filesWithEmbeddings.length} files with existing embeddings out of ${candidateFiles.length} candidates`);

		for (const file of filesWithEmbeddings) {
			try {
				// Get existing embedding from storage (don't generate new ones)
				const embedding = await this.storageService.getEmbedding(file);
				if (!embedding) {
					continue; // Skip if no embedding found
				}
				
				const similarity = this.cosineSimilarity(centroid, embedding);

				if (similarity >= this.settings.embeddingSimilarityThreshold) {
					results.push({ file, similarity });
				}
			} catch (error) {
				console.warn(`[Thoughtlands:EmbeddingService] Failed to generate embedding for ${file.path}:`, error);
				// Continue with other files
			}
		}

		// Sort by similarity (highest first) and return top N
		results.sort((a, b) => b.similarity - a.similarity);
		return results.slice(0, maxResults);
	}
}

