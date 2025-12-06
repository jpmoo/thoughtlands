import { App, TFile } from 'obsidian';

export interface EmbeddingEntry {
	hash: string;
	embedding: number[];
}

export interface EmbeddingsData {
	meta: {
		model: string;
		lastFullBuild: string | null;
		version: string;
	};
	data: Record<string, EmbeddingEntry>;
}

export class EmbeddingStorageService {
	private app: App;
	private plugin: any; // Plugin instance
	private embeddingsData: EmbeddingsData | null = null;

	constructor(app: App, plugin: any) {
		this.app = app;
		this.plugin = plugin;
	}

	async loadEmbeddings(): Promise<EmbeddingsData | null> {
		try {
			// Use plugin's loadData method
			const data = await this.plugin.loadData();
			if (data && data.embeddings) {
				this.embeddingsData = data.embeddings as EmbeddingsData;
				console.log('[Thoughtlands:EmbeddingStorage] Loaded embeddings:', {
					model: this.embeddingsData.meta.model,
					lastFullBuild: this.embeddingsData.meta.lastFullBuild,
					entryCount: Object.keys(this.embeddingsData.data).length
				});
				return this.embeddingsData;
			}
		} catch (error) {
			console.error('[Thoughtlands:EmbeddingStorage] Error loading embeddings:', error);
		}
		
		return null;
	}

	async saveEmbeddings(data: EmbeddingsData): Promise<void> {
		try {
			// Use plugin's saveData method
			const existingData = await this.plugin.loadData() || {};
			existingData.embeddings = data;
			await this.plugin.saveData(existingData);
			this.embeddingsData = data;
			console.log('[Thoughtlands:EmbeddingStorage] Saved embeddings:', {
				model: data.meta.model,
				lastFullBuild: data.meta.lastFullBuild,
				entryCount: Object.keys(data.data).length
			});
		} catch (error) {
			console.error('[Thoughtlands:EmbeddingStorage] Error saving embeddings:', error);
			throw error;
		}
	}

	async getEmbedding(file: TFile): Promise<number[] | null> {
		if (!this.embeddingsData) {
			await this.loadEmbeddings();
		}
		
		if (!this.embeddingsData) {
			return null;
		}
		
		const entry = this.embeddingsData.data[file.path];
		if (!entry) {
			return null;
		}
		
		// Verify hash matches current content
		const currentHash = await this.computeHash(file);
		if (entry.hash !== currentHash) {
			// Content has changed, embedding is stale
			return null;
		}
		
		return entry.embedding;
	}

	async hasEmbedding(file: TFile): Promise<boolean> {
		const embedding = await this.getEmbedding(file);
		return embedding !== null;
	}

	async computeHash(file: TFile): Promise<string> {
		try {
			const content = await this.app.vault.read(file);
			// Use a simple hash (MD5-like, but we'll use a simple string hash)
			// In a real implementation, you might want to use crypto.createHash
			let hash = 0;
			for (let i = 0; i < content.length; i++) {
				const char = content.charCodeAt(i);
				hash = ((hash << 5) - hash) + char;
				hash = hash & hash; // Convert to 32-bit integer
			}
			return Math.abs(hash).toString(16);
		} catch (error) {
			console.error(`[Thoughtlands:EmbeddingStorage] Error computing hash for ${file.path}:`, error);
			return '';
		}
	}

	async updateEmbeddings(updates: Map<TFile, { hash: string; embedding: number[] }>): Promise<void> {
		if (!this.embeddingsData) {
			// Initialize if doesn't exist
			this.embeddingsData = {
				meta: {
					model: 'nomic-embed-text',
					lastFullBuild: null,
					version: '1.0',
				},
				data: {},
			};
		}
		
		// Update entries
		for (const [file, entry] of updates.entries()) {
			this.embeddingsData.data[file.path] = entry;
		}
		
		await this.saveEmbeddings(this.embeddingsData);
	}

	async markFullBuildComplete(model: string): Promise<void> {
		if (!this.embeddingsData) {
			this.embeddingsData = {
				meta: {
					model: model,
					lastFullBuild: new Date().toISOString(),
					version: '1.0',
				},
				data: {},
			};
		} else {
			this.embeddingsData.meta.model = model;
			this.embeddingsData.meta.lastFullBuild = new Date().toISOString();
		}
		
		await this.saveEmbeddings(this.embeddingsData);
	}

	getEmbeddingsData(): EmbeddingsData | null {
		return this.embeddingsData;
	}

	async getMissingFiles(allFiles: TFile[]): Promise<TFile[]> {
		if (!this.embeddingsData) {
			await this.loadEmbeddings();
		}
		
		const missing: TFile[] = [];
		
		for (const file of allFiles) {
			const hasEmbedding = await this.hasEmbedding(file);
			if (!hasEmbedding) {
				missing.push(file);
			}
		}
		
		return missing;
	}

	getProgress(): { total: number; completed: number; percentage: number } {
		if (!this.embeddingsData) {
			return { total: 0, completed: 0, percentage: 0 };
		}
		
		const total = Object.keys(this.embeddingsData.data).length;
		// We can't know the total without scanning, so we'll track this separately
		return { total: 0, completed: total, percentage: 0 };
	}
}

