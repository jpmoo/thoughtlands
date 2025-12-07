import { App, Plugin, PluginSettingTab, Setting, Notice, TFile } from 'obsidian';
import { CanvasService } from './services/canvasService';
import { RegionService } from './services/regionService';
import { NoteService } from './services/noteService';
import { OpenAIService } from './services/openAIService';
import { LocalAIService } from './services/localAIService';
import { EmbeddingService } from './services/embeddingService';
import { TagAffinityCache } from './services/tagAffinityCache';
import { JSONExportService } from './services/jsonExportService';
import { CreateRegionCommands } from './commands/createRegionCommands';
import { ThoughtlandsSettings, DEFAULT_SETTINGS } from './settings/thoughtlandsSettings';
import { ThoughtlandsSidebarView, THOUGHTLANDS_VIEW_TYPE } from './views/thoughtlandsSidebarView';
import { Region } from './models/region';

export interface RegionCreationStatus {
	isCreating: boolean;
	step?: string;
	details?: string;
}

export default class ThoughtlandsPlugin extends Plugin {
	settings: ThoughtlandsSettings;
	canvasService: CanvasService;
	regionService: RegionService;
	noteService: NoteService;
	openAIService: OpenAIService;
	localAIService: LocalAIService;
	embeddingService: EmbeddingService;
	tagAffinityCache: TagAffinityCache;
	jsonExportService: JSONExportService;
	createRegionCommands: CreateRegionCommands;
	private embeddingQueue: TFile[] = [];
	private isProcessingEmbeddingQueue: boolean = false;
	private isInitialized: boolean = false;
	private regionCreationStatus: RegionCreationStatus = { isCreating: false };
	private regionCreationStatusCallbacks: Set<() => void> = new Set();

	async onload() {
		await this.loadSettings();

		// Initialize cache
		this.tagAffinityCache = new TagAffinityCache();

		// Initialize services
		this.regionService = new RegionService(this.settings);
		this.noteService = new NoteService(this.app.metadataCache, this.app.vault, this.settings);
		this.openAIService = new OpenAIService(this.settings, this.tagAffinityCache);
		this.localAIService = new LocalAIService(this.app, this.settings);
		// Pass plugin instance to EmbeddingService so it can use loadData/saveData
		this.embeddingService = new EmbeddingService(this.app, this.settings, this);
		this.canvasService = new CanvasService(this.app);
		this.jsonExportService = new JSONExportService(this.app, this.regionService);
		this.createRegionCommands = new CreateRegionCommands(
			this.app,
			this.regionService,
			this.noteService,
			this.openAIService,
			this.localAIService,
			this.embeddingService,
			this.settings,
			this
		);

		// Load regions from plugin data
		await this.loadRegions();

		// Load embeddings data on startup so completion checks work
		if (this.settings.aiMode === 'local') {
			await this.embeddingService.getStorageService().loadEmbeddings();
		}

		// Mark as initialized after a short delay to avoid processing files from initial load
		setTimeout(() => {
			this.isInitialized = true;
			console.log('[Thoughtlands] Plugin initialized, file monitoring enabled');
		}, 2000); // 2 second delay to let Obsidian finish loading files

		// Register sidebar view
		this.registerView(
			THOUGHTLANDS_VIEW_TYPE,
			(leaf) => new ThoughtlandsSidebarView(
				leaf,
				this.regionService,
				this.canvasService,
				this.createRegionCommands,
				this,
				this.settings,
				() => this.onRegionUpdate()
			)
		);

		// Add commands
		this.addCommands();

		// Add settings tab
		this.addSettingTab(new ThoughtlandsSettingTab(this.app, this));

		// Add ribbon icon to open sidebar
		this.addRibbonIcon('map', 'Thoughtlands', () => {
			this.activateView();
		});

		// Monitor file changes to update embeddings for new/edited files
		// Use a queue to process files one at a time to avoid overwhelming Ollama
		this.registerEvent(
			this.app.vault.on('modify', (file) => {
				if (file instanceof TFile && file.extension === 'md' && this.settings.aiMode === 'local') {
					this.queueEmbeddingUpdate(file, false); // false = modified file
				}
			})
		);

		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && file.extension === 'md' && this.settings.aiMode === 'local') {
					this.queueEmbeddingUpdate(file, true); // true = new file
				}
			})
		);
	}

	onunload() {
		// Cleanup when plugin is unloaded
	}

	async loadSettings() {
		const data = await this.loadData();
		// Load settings from data, merging with defaults
		if (data) {
			// Extract settings (everything except regions)
			const { regions, ...settingsData } = data;
			this.settings = Object.assign({}, DEFAULT_SETTINGS, settingsData);
			// Ensure new settings have default values if not present
			if (!this.settings.aiMode) this.settings.aiMode = 'openai';
			if (!this.settings.ollamaUrl) this.settings.ollamaUrl = 'http://localhost:11434';
			if (!this.settings.ollamaEmbeddingModel) this.settings.ollamaEmbeddingModel = 'nomic-embed-text';
			if (!this.settings.ollamaChatModel) this.settings.ollamaChatModel = 'llama3.2';
			if (!this.settings.includedPaths) this.settings.includedPaths = [];
			if (!this.settings.includedTags) this.settings.includedTags = [];
			if (!this.settings.embeddingSimilarityThreshold) this.settings.embeddingSimilarityThreshold = 0.7;
			if (!this.settings.maxEmbeddingResults) this.settings.maxEmbeddingResults = 20;
		} else {
			this.settings = Object.assign({}, DEFAULT_SETTINGS);
		}
	}

	async saveSettings() {
		// Save settings along with regions to preserve both
		const existingData = await this.loadData();
		const data: any = existingData ? { ...existingData } : {};
		
		// Update settings
		data.aiMode = this.settings.aiMode;
		data.openAIApiKey = this.settings.openAIApiKey;
		data.ollamaUrl = this.settings.ollamaUrl;
		data.ollamaEmbeddingModel = this.settings.ollamaEmbeddingModel;
		data.ollamaChatModel = this.settings.ollamaChatModel;
		data.ignoredTags = this.settings.ignoredTags;
		data.ignoredPaths = this.settings.ignoredPaths;
		data.includedPaths = this.settings.includedPaths;
		data.includedTags = this.settings.includedTags;
		data.defaultColors = this.settings.defaultColors;
		data.aiModel = this.settings.aiModel;
		data.embeddingSimilarityThreshold = this.settings.embeddingSimilarityThreshold;
		data.maxEmbeddingResults = this.settings.maxEmbeddingResults;
		
		// Preserve regions if they exist (don't overwrite)
		if (existingData?.regions && Array.isArray(existingData.regions)) {
			data.regions = existingData.regions;
		}
		
		await this.saveData(data);
		
		// Update all services with new settings
		if (this.regionService) {
			this.regionService.updateSettings(this.settings);
		}
		if (this.noteService) {
			this.noteService.updateSettings(this.settings);
		}
		if (this.openAIService) {
			this.openAIService.updateSettings(this.settings);
		}
		if (this.localAIService) {
			this.localAIService.updateSettings(this.settings);
		}
		if (this.embeddingService) {
			this.embeddingService.updateSettings(this.settings);
		}
		// Update commands with new settings
		if (this.createRegionCommands) {
			this.createRegionCommands.updateSettings(this.settings);
		}
		
		// Update sidebar view to show/hide AI button
		const sidebarLeaves = this.app.workspace.getLeavesOfType(THOUGHTLANDS_VIEW_TYPE);
		for (const leaf of sidebarLeaves) {
			const view = leaf.view as ThoughtlandsSidebarView;
			if (view && typeof view.updateSettings === 'function') {
				view.updateSettings(this.settings);
			}
		}
	}

	async loadRegions() {
		const data = await this.loadData();
		if (data?.regions && Array.isArray(data.regions)) {
			this.regionService.setRegions(data.regions);
		}
	}

	async saveRegions() {
		const regions = this.regionService.getRegions();
		// Save regions along with settings to preserve both
		const existingData = await this.loadData();
		const data: any = existingData ? { ...existingData } : {};
		
		// Update regions
		data.regions = regions;
		
		// Update with current settings (merge with existing to preserve any other properties)
		if (this.settings) {
			data.openAIApiKey = this.settings.openAIApiKey;
			data.ignoredTags = this.settings.ignoredTags;
			data.ignoredPaths = this.settings.ignoredPaths;
			data.includedPaths = this.settings.includedPaths;
			data.includedTags = this.settings.includedTags;
			data.defaultColors = this.settings.defaultColors;
			data.aiModel = this.settings.aiModel;
		}
		
		await this.saveData(data);
		
		// Also export to JSON file
		try {
			await this.jsonExportService.exportRegionsToJSON();
		} catch (error) {
			console.error('Error exporting regions to JSON:', error);
		}
	}

	async onRegionUpdate() {
		await this.saveRegions();
		// Refresh sidebar view if open
		const leaves = this.app.workspace.getLeavesOfType(THOUGHTLANDS_VIEW_TYPE);
		leaves.forEach(leaf => {
			if (leaf.view instanceof ThoughtlandsSidebarView) {
				leaf.view.render();
			}
		});
	}

	getRegionCreationStatus(): RegionCreationStatus {
		return this.regionCreationStatus;
	}

	updateRegionCreationStatus(status: RegionCreationStatus): void {
		this.regionCreationStatus = status;
		// Notify all subscribers
		this.regionCreationStatusCallbacks.forEach(callback => callback());
		// Also trigger sidebar re-render
		this.onRegionUpdate();
	}

	subscribeToRegionCreationStatus(callback: () => void): () => void {
		this.regionCreationStatusCallbacks.add(callback);
		return () => {
			this.regionCreationStatusCallbacks.delete(callback);
		};
	}

	private addCommands() {
		// Create Region from Search Results
		this.addCommand({
			id: 'create-region-from-search',
			name: 'Create Region from Search Results',
			callback: async () => {
				await this.createRegionCommands.createRegionFromSearch();
				await this.onRegionUpdate();
			},
		});

		// Create Region from Search + Tag Expansion
		this.addCommand({
			id: 'create-region-from-search-tags',
			name: 'Create Region from Search + Tag Expansion',
			callback: async () => {
				await this.createRegionCommands.createRegionFromSearchWithTags();
				await this.onRegionUpdate();
			},
		});

		// Generate Initial Embeddings
		this.addCommand({
			id: 'generate-initial-embeddings',
			name: 'Generate Initial Embeddings',
			callback: async () => {
				await this.generateInitialEmbeddings();
			},
		});

		// Create Region from AI Concept Search (register if OpenAI key or local mode enabled)
		const showAICommand = (this.settings.aiMode === 'openai' && this.settings.openAIApiKey && this.settings.openAIApiKey.trim().length > 0) ||
		                      (this.settings.aiMode === 'local');
		
		if (showAICommand) {
			this.addCommand({
				id: 'create-region-from-concept',
				name: 'Create Region from AI-Assisted Concept/Tag Analysis',
				callback: async () => {
					await this.createRegionCommands.createRegionFromConcept();
					await this.onRegionUpdate();
				},
			});
		}

		// Export Regions to JSON
		this.addCommand({
			id: 'export-regions-json',
			name: 'Export Regions to JSON',
			callback: async () => {
				try {
					await this.jsonExportService.exportRegionsToJSON();
					new Notice('Regions exported to regions.json');
				} catch (error) {
					new Notice(`Error exporting regions: ${error}`);
				}
			},
		});

		// Open Thoughtlands Sidebar
		this.addCommand({
			id: 'open-thoughtlands-sidebar',
			name: 'Open Thoughtlands Sidebar',
			callback: () => {
				this.activateView();
			},
		});
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(THOUGHTLANDS_VIEW_TYPE)[0];
		if (!leaf) {
			const newLeaf = workspace.getRightLeaf(false);
			if (newLeaf) {
				await newLeaf.setViewState({ type: THOUGHTLANDS_VIEW_TYPE, active: true });
				leaf = newLeaf;
			}
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}

	async generateInitialEmbeddings(): Promise<void> {
		const allFiles = this.app.vault.getMarkdownFiles();
		console.log(`[Thoughtlands] Starting embedding process. Total files in vault: ${allFiles.length}`);
		console.log(`[Thoughtlands] Current filter settings:`, {
			includedPaths: this.settings.includedPaths,
			ignoredPaths: this.settings.ignoredPaths,
			includedTags: this.settings.includedTags,
			ignoredTags: this.settings.ignoredTags
		});
		
		// Filter by ignored paths and tags (this also checks included paths)
		const filteredFiles = this.regionService.filterNotesByIgnores(allFiles);
		
		// Also filter by included tags if set
		const finalFiles = filteredFiles.filter(file => {
			// Check included tags if set
			if (this.settings.includedTags.length > 0) {
				const fileCache = this.app.metadataCache.getFileCache(file);
				if (fileCache) {
					const fileTags = this.noteService['extractTags'](fileCache);
					const fileTagsLower = fileTags.map(ft => ft.toLowerCase());
					const hasIncludedTag = fileTagsLower.some(fileTag =>
						this.settings.includedTags.some(included =>
							included.toLowerCase() === fileTag
						)
					);
					if (!hasIncludedTag) {
						return false;
					}
				}
			}
			return true;
		});
		
		new Notice(`Starting embedding process for ${finalFiles.length} notes...`);
		
		try {
			await this.embeddingService.generateInitialEmbeddings(finalFiles, (progress) => {
				// Update status bar
				this.updateEmbeddingProgress(progress);
			});
			new Notice(`Embedding process complete!`);
			// Trigger sidebar re-render to show/hide UI elements
			this.onRegionUpdate();
		} catch (error) {
			console.error('[Thoughtlands] Error generating initial embeddings:', error);
			new Notice(`Error: ${error instanceof Error ? error.message : 'Failed to generate embeddings'}`);
			// Trigger sidebar re-render even on error
			this.onRegionUpdate();
		}
	}

	private updateEmbeddingProgress(progress: import('./services/embeddingService').EmbeddingProgress): void {
		// This will be called by the settings tab to update the UI
		// The settings tab will listen to progress updates
	}

	async deleteEmbeddings(): Promise<void> {
		try {
			const data = await this.loadData() || {};
			delete data.embeddings;
			await this.saveData(data);
			// Clear the in-memory cache
			this.embeddingService.getStorageService()['embeddingsData'] = null;
			console.log('[Thoughtlands] Embeddings deleted');
		} catch (error) {
			console.error('[Thoughtlands] Error deleting embeddings:', error);
			throw error;
		}
	}

	private queueEmbeddingUpdate(file: TFile, isNew: boolean): void {
		// First check if file should be included/excluded (before any logging)
		const filtered = this.regionService.filterNotesByIgnores([file]);
		if (filtered.length === 0) {
			// File is outside included paths or in ignored paths - silently skip
			return;
		}

		// Don't process files until plugin is fully initialized
		// This prevents processing files that Obsidian fires 'create' events for on startup
		if (!this.isInitialized) {
			// Only log if file is in scope (already filtered above)
			return; // Silent skip during initialization
		}

		// Only process if embeddings are complete (initial build done)
		if (!this.embeddingService.isEmbeddingProcessComplete()) {
			return; // Silent skip if embeddings not complete
		}

		// Add to queue if not already queued
		if (!this.embeddingQueue.some((f: TFile) => f.path === file.path)) {
			this.embeddingQueue.push(file);
		}
		
		// Start processing queue if not already processing
		if (!this.isProcessingEmbeddingQueue) {
			this.processEmbeddingQueue();
		}
	}

	private async processEmbeddingQueue(): Promise<void> {
		if (this.isProcessingEmbeddingQueue) {
			return; // Already processing
		}
		
		this.isProcessingEmbeddingQueue = true;
		
		while (this.embeddingQueue.length > 0) {
			const file = this.embeddingQueue.shift();
			if (!file) break;
			
			// Determine if it's new (check if it was just created)
			const isNew = true; // We'll track this better if needed, but for now assume new
			
			try {
				await this.updateEmbeddingForFile(file, isNew);
			} catch (error) {
				console.error(`[Thoughtlands] Error processing ${file.path} from queue:`, error);
			}
			
			// Small delay between files to avoid overwhelming Ollama
			if (this.embeddingQueue.length > 0) {
				await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay between files
			}
		}
		
		this.isProcessingEmbeddingQueue = false;
	}

	async updateEmbeddingForFile(file: TFile, isNew: boolean = false): Promise<void> {
		// Only update if embeddings are complete (initial build done)
		if (!this.embeddingService.isEmbeddingProcessComplete()) {
			return;
		}

		// Check if file already has a current embedding
		const storageService = this.embeddingService.getStorageService();
		const hasCurrentEmbedding = await storageService.hasEmbedding(file);
		
		// If file already has a current embedding, skip it (no need to regenerate)
		if (hasCurrentEmbedding) {
			console.log(`[Thoughtlands] Skipping ${file.path} - already has current embedding`);
			return;
		}
		
		// Log what we're doing
		const fileType = isNew ? 'new' : 'modified';
		console.log(`[Thoughtlands] Processing ${fileType} file: ${file.path}`);

		// Check if file should be included/excluded
		const filtered = this.regionService.filterNotesByIgnores([file]);
		if (filtered.length === 0) {
			console.log(`[Thoughtlands] Skipping ${file.path} (excluded by filters)`);
			return; // File is excluded
		}

		// Check included tags if set
		if (this.settings.includedTags.length > 0) {
			const fileCache = this.app.metadataCache.getFileCache(file);
			if (fileCache) {
				const fileTags = this.noteService['extractTags'](fileCache);
				const fileTagsLower = fileTags.map(ft => ft.toLowerCase());
				const hasIncludedTag = fileTagsLower.some(fileTag =>
					this.settings.includedTags.some(included =>
						included.toLowerCase() === fileTag
					)
				);
				if (!hasIncludedTag) {
					console.log(`[Thoughtlands] Skipping ${file.path} (no included tags)`);
					return; // File doesn't have included tags
				}
			}
		}

		try {
			// Generate embedding for the file (this will update storage if hash changed)
			await this.embeddingService.generateEmbeddingForFile(file);
			// Only log if there's an error or in debug mode
		} catch (error) {
			console.warn(`[Thoughtlands] Failed to update embedding for ${file.path} (${fileType}):`, error);
		}
	}
}

class ThoughtlandsSettingTab extends PluginSettingTab {
	plugin: ThoughtlandsPlugin;
	ollamaStatusSetting?: Setting;
	embeddingProgressSetting?: Setting;
	private progressUnsubscribe?: () => void;

	constructor(app: App, plugin: ThoughtlandsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	updateEmbeddingProgress(progress: import('./services/embeddingService').EmbeddingProgress): void {
		if (!this.embeddingProgressSetting) return;

		const progressText = progress.total > 0
			? `Embedding notes: ${progress.completed} / ${progress.total} (${progress.percentage}%)${progress.currentFile ? ` - ${progress.currentFile}` : ''}`
			: 'No embedding process running';
		
		this.embeddingProgressSetting.setDesc(progressText);
	}

	async checkOllamaStatus(): Promise<void> {
		if (!this.ollamaStatusSetting) return;

		const status = await this.plugin.embeddingService.checkOllamaStatus();
		
		let statusText = '';
		let statusColor = '';
		
		if (status.available && status.modelInstalled) {
			statusText = `✓ Ollama connected, model "${status.modelName}" available`;
			statusColor = 'var(--text-success)';
		} else if (status.available && !status.modelInstalled) {
			statusText = `⚠ Ollama connected, but model "${status.modelName}" not found`;
			statusColor = 'var(--text-warning)';
		} else {
			statusText = `✗ Ollama not available: ${status.error || 'Connection failed'}`;
			statusColor = 'var(--text-error)';
		}

		this.ollamaStatusSetting.setDesc(statusText);
		// Update the desc element color if possible
		const descEl = this.ollamaStatusSetting.descEl;
		if (descEl) {
			descEl.style.color = statusColor;
		}
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Thoughtlands Settings' });

		// AI Mode Selection
		const aiModeSetting = new Setting(containerEl)
			.setName('AI Mode')
			.setDesc('Choose between OpenAI (cloud) or Local (Ollama) for AI features')
			.addDropdown(dropdown => {
				dropdown
					.addOption('openai', 'OpenAI (ChatGPT)')
					.addOption('local', 'Local (Ollama)')
					.setValue(this.plugin.settings.aiMode)
					.onChange(async (value) => {
						this.plugin.settings.aiMode = value as 'openai' | 'local';
						await this.plugin.saveSettings();
						this.display(); // Refresh to show/hide relevant settings
					});
			});

		// Ollama Status
		const ollamaStatusSetting = new Setting(containerEl)
			.setName('Ollama Status')
			.setDesc('Checking Ollama connection and model availability...')
			.addExtraButton(button => {
				button.setIcon('refresh-cw')
					.setTooltip('Refresh status')
					.onClick(async () => {
						await this.checkOllamaStatus();
					});
			});

		// Store reference to update status
		this.ollamaStatusSetting = ollamaStatusSetting;
		this.checkOllamaStatus();

		// Embedding Progress (only show if local mode)
		if (this.plugin.settings.aiMode === 'local') {
			const embeddingProgressSetting = new Setting(containerEl)
				.setName('Embedding Progress')
				.setDesc('No embedding process running');
			
			this.embeddingProgressSetting = embeddingProgressSetting;
			
			// Subscribe to progress updates
			if (this.progressUnsubscribe) {
				this.progressUnsubscribe();
			}
			this.progressUnsubscribe = this.plugin.embeddingService.onProgress((progress) => {
				this.updateEmbeddingProgress(progress);
			});
			
			// Show current progress if available
			const currentProgress = this.plugin.embeddingService.getCurrentProgress();
			if (currentProgress) {
				this.updateEmbeddingProgress(currentProgress);
			}
			
			// Check if embeddings are complete
			const isComplete = this.plugin.embeddingService.isEmbeddingProcessComplete();
			if (isComplete) {
				const storageData = this.plugin.embeddingService.getStorageService().getEmbeddingsData();
				if (storageData) {
					const completed = Object.keys(storageData.data).length;
					embeddingProgressSetting.setDesc(`✓ Embeddings complete: ${completed} notes embedded (last build: ${storageData.meta.lastFullBuild ? new Date(storageData.meta.lastFullBuild).toLocaleString() : 'unknown'})`);
					
					// Add button to delete/redo embeddings
					embeddingProgressSetting.addButton(button => {
						button.setButtonText('Delete & Rebuild')
							.setCta()
							.onClick(async () => {
								const confirmed = confirm('This will delete all existing embeddings and require a full rebuild. Continue?');
								if (confirmed) {
									await this.plugin.deleteEmbeddings();
									new Notice('Embeddings deleted. Run "Generate Initial Embeddings" to rebuild.');
									this.display(); // Refresh settings
								}
							});
					});
				}
			} else {
				// Add note about AI analysis availability
				embeddingProgressSetting.setDesc('No embedding process running. Note: The AI-Assisted Concept/Tag Analysis option will not be available until initial embeddings are complete.');
			}
		}

		// Ollama Settings (only show if local mode)
		if (this.plugin.settings.aiMode === 'local') {
			new Setting(containerEl)
				.setName('Ollama URL')
				.setDesc('URL for Ollama API (default: http://localhost:11434)')
				.addText(text => {
					text.setPlaceholder('http://localhost:11434')
						.setValue(this.plugin.settings.ollamaUrl);
					text.onChange(async (value) => {
						this.plugin.settings.ollamaUrl = value.trim() || 'http://localhost:11434';
						await this.plugin.saveSettings();
						await this.checkOllamaStatus();
					});
				});

			new Setting(containerEl)
				.setName('Embedding Model')
				.setDesc('Ollama model name for embeddings (e.g., nomic-embed-text)')
				.addText(text => {
					text.setPlaceholder('nomic-embed-text')
						.setValue(this.plugin.settings.ollamaEmbeddingModel);
					text.onChange(async (value) => {
						this.plugin.settings.ollamaEmbeddingModel = value.trim() || 'nomic-embed-text';
						await this.plugin.saveSettings();
						await this.checkOllamaStatus();
					});
				});

			new Setting(containerEl)
				.setName('Chat Model')
				.setDesc('Ollama model name for tag analysis (e.g., llama3.2)')
				.addText(text => {
					text.setPlaceholder('llama3.2')
						.setValue(this.plugin.settings.ollamaChatModel);
					text.onChange(async (value) => {
						this.plugin.settings.ollamaChatModel = value.trim() || 'llama3.2';
						await this.plugin.saveSettings();
					});
				});

			new Setting(containerEl)
				.setName('Embedding Similarity Threshold')
				.setDesc('Minimum similarity (0-1) for notes to be considered relevant. Higher = more strict.')
				.addSlider(slider => {
					slider
						.setLimits(0, 1, 0.05)
						.setValue(this.plugin.settings.embeddingSimilarityThreshold)
						.setDynamicTooltip()
						.onChange(async (value) => {
							this.plugin.settings.embeddingSimilarityThreshold = value;
							await this.plugin.saveSettings();
						});
				});

			new Setting(containerEl)
				.setName('Max Embedding Results')
				.setDesc('Maximum number of additional notes to add via embedding similarity analysis (beyond those found through tag matching). This limit applies only to notes discovered through embeddings, not the total number of notes in the region.')
				.addText(text => {
					text.setPlaceholder('20')
						.setValue(this.plugin.settings.maxEmbeddingResults.toString());
					text.inputEl.type = 'number';
					text.onChange(async (value) => {
						const num = parseInt(value);
						if (!isNaN(num) && num > 0) {
							this.plugin.settings.maxEmbeddingResults = num;
							await this.plugin.saveSettings();
						}
					});
				});
		}

		// OpenAI Settings (only show if OpenAI mode)
		if (this.plugin.settings.aiMode === 'openai') {
			new Setting(containerEl)
				.setName('OpenAI API Key')
				.setDesc('Your OpenAI API key for AI concept search')
				.addText(text => {
					text.setPlaceholder('sk-...')
						.setValue(this.plugin.settings.openAIApiKey);
					text.inputEl.type = 'password';
					text.onChange(async (value) => {
						this.plugin.settings.openAIApiKey = value;
						await this.plugin.saveSettings();
					});
				});

			new Setting(containerEl)
				.setName('AI Model')
				.setDesc('OpenAI model to use for concept search')
				.addDropdown(dropdown => {
					dropdown
						.addOption('gpt-3.5-turbo', 'GPT-3.5 Turbo')
						.addOption('gpt-4', 'GPT-4')
						.addOption('gpt-4-turbo-preview', 'GPT-4 Turbo')
						.setValue(this.plugin.settings.aiModel)
						.onChange(async (value) => {
							this.plugin.settings.aiModel = value;
							await this.plugin.saveSettings();
						});
				});
		}

		// Included Tags
		new Setting(containerEl)
			.setName('Included Tags')
			.setDesc('Tags to include (one per line, without #). Leave empty to include all tags.')
			.addTextArea(text => {
				text.setPlaceholder('project\nimportant\n(leave empty for all)')
					.setValue(this.plugin.settings.includedTags.join('\n'));
				text.inputEl.rows = 3;
				text.onChange(async (value) => {
					this.plugin.settings.includedTags = value
						.split('\n')
						.map(t => t.trim())
						.filter(t => t.length > 0);
					await this.plugin.saveSettings();
				});
			});

		// Included Paths
		new Setting(containerEl)
			.setName('Included Paths')
			.setDesc('Folders to include (one per line). Leave empty to include all folders.')
			.addTextArea(text => {
				text.setPlaceholder('Projects/\nNotes/\n(leave empty for all)')
					.setValue(this.plugin.settings.includedPaths.join('\n'));
				text.inputEl.rows = 3;
				text.onChange(async (value) => {
					this.plugin.settings.includedPaths = value
						.split('\n')
						.map(p => p.trim())
						.filter(p => p.length > 0);
					await this.plugin.saveSettings();
				});
			});

		// Ignored Tags
		new Setting(containerEl)
			.setName('Ignored Tags')
			.setDesc('Tags to ignore (one per line, without #)')
			.addTextArea(text => {
				text.setPlaceholder('tag1\ntag2\ntag3')
					.setValue(this.plugin.settings.ignoredTags.join('\n'));
				text.inputEl.rows = 5;
				text.onChange(async (value) => {
					this.plugin.settings.ignoredTags = value
						.split('\n')
						.map(t => t.trim())
						.filter(t => t.length > 0);
					await this.plugin.saveSettings();
				});
			});

		// Ignored Paths
		new Setting(containerEl)
			.setName('Ignored Paths')
			.setDesc('Paths to ignore (one per line)')
			.addTextArea(text => {
				text.setPlaceholder('Templates/\nArchive/')
					.setValue(this.plugin.settings.ignoredPaths.join('\n'));
				text.inputEl.rows = 5;
				text.onChange(async (value) => {
					this.plugin.settings.ignoredPaths = value
						.split('\n')
						.map(p => p.trim())
						.filter(p => p.length > 0);
					await this.plugin.saveSettings();
				});
			});

		// Default Colors
		new Setting(containerEl)
			.setName('Default Color Palette')
			.setDesc('Default colors for regions (comma-separated hex codes)')
			.addText(text => text
				.setPlaceholder('#E67E22, #3498DB, #9B59B6')
				.setValue(this.plugin.settings.defaultColors.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.defaultColors = value
						.split(',')
						.map(c => c.trim())
						.filter(c => /^#[0-9A-Fa-f]{6}$/i.test(c));
					await this.plugin.saveSettings();
				}));

	}
}
