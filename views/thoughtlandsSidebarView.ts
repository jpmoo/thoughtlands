import { ItemView, WorkspaceLeaf, Notice, Plugin } from 'obsidian';
import { Region, getModeDisplayName } from '../models/region';
import { RegionService } from '../services/regionService';
import { CreateRegionCommands } from '../commands/createRegionCommands';
import { RegionInfoModal } from '../ui/regionInfoModal';
import { CanvasService } from '../services/canvasService';
import { CanvasSelectModal } from '../ui/canvasSelectModal';
import { ThoughtlandsSettings } from '../settings/thoughtlandsSettings';

export const THOUGHTLANDS_VIEW_TYPE = 'thoughtlands-sidebar';

export class ThoughtlandsSidebarView extends ItemView {
	private regionService: RegionService;
	private canvasService: CanvasService;
	private createRegionCommands: CreateRegionCommands;
	private plugin: Plugin;
	private settings: ThoughtlandsSettings;
	private onRegionUpdate: () => void;
	private progressUnsubscribe?: () => void;
	private regionStatusUnsubscribe?: () => void;

	constructor(
		leaf: WorkspaceLeaf,
		regionService: RegionService,
		canvasService: CanvasService,
		createRegionCommands: CreateRegionCommands,
		plugin: Plugin,
		settings: ThoughtlandsSettings,
		onRegionUpdate: () => void
	) {
		super(leaf);
		this.regionService = regionService;
		this.canvasService = canvasService;
		this.createRegionCommands = createRegionCommands;
		this.plugin = plugin;
		this.settings = settings;
		this.onRegionUpdate = onRegionUpdate;
	}

	getViewType() {
		return THOUGHTLANDS_VIEW_TYPE;
	}

	getDisplayText() {
		return 'Thoughtlands';
	}

	getIcon() {
		return 'map';
	}

	async onOpen() {
		// Ensure embeddings are loaded before rendering
		if (this.settings.aiMode === 'local') {
			const embeddingService = (this.plugin as any).embeddingService;
			if (embeddingService) {
				await embeddingService.getStorageService().loadEmbeddings();
				// Subscribe to progress updates to re-render when process starts/stops
				if (this.progressUnsubscribe) {
					this.progressUnsubscribe();
				}
				this.progressUnsubscribe = embeddingService.onProgress(() => {
					this.render();
				});
			}
		}
		
		// Subscribe to region creation status updates
		if (this.regionStatusUnsubscribe) {
			this.regionStatusUnsubscribe();
		}
		const plugin = this.plugin as any;
		if (plugin.subscribeToRegionCreationStatus) {
			this.regionStatusUnsubscribe = plugin.subscribeToRegionCreationStatus(() => {
				this.render();
			});
		}
		
		this.render();
	}

	async onClose() {
		// Cleanup progress subscription
		if (this.progressUnsubscribe) {
			this.progressUnsubscribe();
			this.progressUnsubscribe = undefined;
		}
		// Cleanup region status subscription
		if (this.regionStatusUnsubscribe) {
			this.regionStatusUnsubscribe();
			this.regionStatusUnsubscribe = undefined;
		}
	}

	render() {
		const { containerEl } = this;
		containerEl.empty();
		
		// Make the container scrollable
		containerEl.style.overflowY = 'auto';
		containerEl.style.height = '100%';
		containerEl.style.display = 'flex';
		containerEl.style.flexDirection = 'column';

		const header = containerEl.createDiv({ 
			attr: { 
				style: 'padding: 10px; border-bottom: 1px solid var(--background-modifier-border); display: flex; justify-content: space-between; align-items: center;' 
			} 
		});
		header.createEl('h2', { text: 'Thoughtlands', attr: { style: 'margin: 0;' } });
		
		// Settings button with gear icon
		const settingsButton = header.createEl('button', {
			attr: {
				style: 'background: transparent; border: none; cursor: pointer; padding: 4px 8px; border-radius: 4px; display: flex; align-items: center; justify-content: center;',
				title: 'Open Thoughtlands Settings',
				'aria-label': 'Settings'
			}
		});
		settingsButton.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
		settingsButton.addEventListener('click', () => {
			(this.app as any).setting.open();
			(this.app as any).setting.openTabById('thoughtlands');
		});
		settingsButton.addEventListener('mouseenter', () => {
			settingsButton.style.backgroundColor = 'var(--background-modifier-hover)';
		});
		settingsButton.addEventListener('mouseleave', () => {
			settingsButton.style.backgroundColor = 'transparent';
		});

		// Embedding status and start button (only show if local mode)
		if (this.settings.aiMode === 'local') {
			const embeddingService = (this.plugin as any).embeddingService;
			// Check embeddings completion and processing status
			let embeddingsComplete = false;
			let isProcessing = false;
			if (embeddingService) {
				// Check if processing is in progress
				isProcessing = embeddingService.isEmbeddingProcessInProgress();
				
				// Try to load embeddings data synchronously if not already loaded
				const storageService = embeddingService.getStorageService();
				const currentData = storageService.getEmbeddingsData();
				if (!currentData) {
					// Data not loaded, try to load it (but this is async, so we'll check after)
					storageService.loadEmbeddings().then(() => {
						const isComplete = embeddingService.isEmbeddingProcessComplete();
						const stillProcessing = embeddingService.isEmbeddingProcessInProgress();
						if (isComplete || stillProcessing) {
							this.render(); // Re-render to hide/show the section
						}
					}).catch((err: any) => {
						console.error('[Thoughtlands:Sidebar] Error loading embeddings:', err);
					});
				} else {
					// Data is already loaded, check synchronously
					embeddingsComplete = embeddingService.isEmbeddingProcessComplete();
				}
			}
			
			// Show the section if embeddings are not complete AND not currently processing
			if (!embeddingsComplete && !isProcessing) {
				const embeddingSection = containerEl.createDiv({ 
					attr: { style: 'padding: 10px; border-bottom: 1px solid var(--background-modifier-border); background-color: var(--background-modifier-form-field-highlighted);' } 
				});
				embeddingSection.createEl('h3', { 
					text: 'Embeddings Required', 
					attr: { style: 'margin-top: 0; margin-bottom: 10px; font-size: 1em; color: var(--text-warning);' } 
				});
				embeddingSection.createEl('p', { 
					text: 'Because you are using a local model, embeddings must be generated before using AI-assisted region creation. This process analyzes all notes in your vault for semantic similarity.',
					attr: { style: 'margin: 0 0 10px 0; font-size: 0.9em; color: var(--text-muted);' }
				});
				
				const generateButton = embeddingSection.createEl('button', { 
					text: 'Generate Initial Embeddings',
					attr: { 
						style: 'width: 100%; padding: 10px; text-align: center; font-weight: bold;',
						title: 'Start the embedding generation process for all notes in your vault'
					}
				});
				
				generateButton.addEventListener('click', async () => {
					// Access the plugin's generateInitialEmbeddings method
					const plugin = this.plugin as any;
					if (plugin && typeof plugin.generateInitialEmbeddings === 'function') {
						await plugin.generateInitialEmbeddings();
						// Re-render to update the UI
						this.render();
					} else {
						// Fallback: use command
						await (this.app as any).commands.executeCommandById('thoughtlands:generate-initial-embeddings');
						this.render();
					}
				});
			}
		}

		// Action buttons section
		const actionsSection = containerEl.createDiv({ 
			attr: { style: 'padding: 10px; border-bottom: 1px solid var(--background-modifier-border);' } 
		});
		actionsSection.createEl('h3', { 
			text: 'Create Region', 
			attr: { style: 'margin-top: 0; margin-bottom: 10px; font-size: 1em;' } 
		});

		const buttonsContainer = actionsSection.createDiv({ 
			attr: { style: 'display: flex; flex-direction: column; gap: 8px;' } 
		});

		// Button 1: Create Region from Search Results
		const searchButton = buttonsContainer.createEl('button', { 
			text: 'From Search Results',
			attr: { 
				style: 'width: 100%; padding: 8px; text-align: left;',
				title: 'Create region from current Obsidian search results.'
			}
		});
		searchButton.addEventListener('click', async () => {
			await this.createRegionCommands.createRegionFromSearch();
			await this.onRegionUpdate();
			this.render();
		});

		// Button 2: Create Region from Search Results + AI Analysis (only if local model is active)
		if (this.settings.aiMode === 'local') {
			const searchAIAnalysisButton = buttonsContainer.createEl('button', { 
				text: 'From Search Results + AI Analysis',
				attr: { 
					style: 'width: 100%; padding: 8px; text-align: left;',
					title: 'Use AI to examine search results and see if there are other related notes.'
				}
			});
			searchAIAnalysisButton.addEventListener('click', async () => {
				await this.createRegionCommands.createRegionFromSearchWithAIAnalysis();
				await this.onRegionUpdate();
				this.render();
			});
		}

		// Button 3: Create Region from AI Concept Search (show if OpenAI key or local mode enabled)
		const showAIButton = (this.settings.aiMode === 'openai' && this.settings.openAIApiKey && this.settings.openAIApiKey.trim().length > 0) ||
		                     (this.settings.aiMode === 'local');
		
		// Check if embeddings are complete and not processing for local mode
		// Access embeddingService through the plugin instance
		let embeddingsComplete = true;
		let isProcessing = false;
		if (this.settings.aiMode === 'local') {
			const embeddingService = (this.plugin as any).embeddingService;
			if (embeddingService) {
				// Check if processing is in progress
				isProcessing = embeddingService.isEmbeddingProcessInProgress();
				
				// Ensure data is loaded, then check
				embeddingService.getStorageService().loadEmbeddings().then(() => {
					const complete = embeddingService.isEmbeddingProcessComplete();
					const processing = embeddingService.isEmbeddingProcessInProgress();
					embeddingsComplete = complete;
					// Re-render if status changed
					if (!embeddingsComplete || processing) {
						this.render();
					}
				}).catch(() => {
					embeddingsComplete = false;
				});
			}
		}
		
		// Only show AI button if embeddings are complete AND not processing
		if (showAIButton && embeddingsComplete && !isProcessing) {
			let tooltipText = `Use ${this.settings.aiMode === 'local' ? 'local model' : 'AI'} to gather notes that have tags relevant to certain concepts that you provide.`;
			if (this.settings.aiMode === 'local') {
				tooltipText += ' Refine the selection with semantic similarity analysis.';
			}
			
			const conceptButton = buttonsContainer.createEl('button', { 
				text: 'From AI-Assisted Concept/Tag Analysis',
				attr: { 
					style: 'width: 100%; padding: 8px; text-align: left;',
					title: tooltipText
				}
			});
			
				conceptButton.addEventListener('click', async () => {
					await this.createRegionCommands.createRegionFromConcept();
					await this.onRegionUpdate();
					this.render();
				});
		}

		// Button 4: Create Region from Semantic Similarity Analysis (only if local mode enabled)
		if (this.settings.aiMode === 'local') {
			// Check if embeddings are complete and not processing
			const embeddingService = (this.plugin as any).embeddingService;
			let embeddingsComplete = true;
			let isProcessing = false;
			if (embeddingService) {
				// Check if processing is in progress
				isProcessing = embeddingService.isEmbeddingProcessInProgress();
				
				// Ensure data is loaded, then check
				embeddingService.getStorageService().loadEmbeddings().then(() => {
					const complete = embeddingService.isEmbeddingProcessComplete();
					const processing = embeddingService.isEmbeddingProcessInProgress();
					embeddingsComplete = complete;
					// Re-render if status changed
					if (!embeddingsComplete || processing) {
						this.render();
					}
				}).catch(() => {
					embeddingsComplete = false;
				});
			}
			
			// Only show semantic similarity button if embeddings are complete AND not processing
			if (embeddingsComplete && !isProcessing) {
				const semanticButton = buttonsContainer.createEl('button', { 
					text: 'From Semantic Similarity Analysis',
					attr: { 
						style: 'width: 100%; padding: 8px; text-align: left;',
						title: 'Examine the semantic similarilty between descriptive text you enter and the notes in your vault. Returns up to 100 notes. To be more selective, increase the embedding similarity threshold in settings.'
					}
				});
				
				semanticButton.addEventListener('click', async () => {
					await this.createRegionCommands.createRegionFromSemanticSimilarity();
					await this.onRegionUpdate();
					this.render();
				});
			}
		}

		// Check if region creation is in progress
		const plugin = this.plugin as any;
		const creationStatus = plugin.getRegionCreationStatus ? plugin.getRegionCreationStatus() : { isCreating: false };
		
		// Show loading indicator if region creation is in progress
		if (creationStatus.isCreating) {
			const loadingSection = containerEl.createDiv({ 
				attr: { 
					style: 'padding: 15px; margin: 10px; border: 2px solid var(--text-accent); border-radius: 4px; background: var(--background-modifier-form-field-highlighted);' 
				} 
			});
			
			// Spinner and text
			const loadingHeader = loadingSection.createDiv({ 
				attr: { style: 'display: flex; align-items: center; margin-bottom: 8px;' } 
			});
			
			// Simple spinner (rotating dots)
			const spinner = loadingHeader.createDiv({
				attr: { 
					style: 'width: 16px; height: 16px; margin-right: 8px; border: 2px solid var(--text-muted); border-top-color: var(--text-accent); border-radius: 50%; animation: spin 1s linear infinite;'
				}
			});
			
			// Add CSS animation if not already added
			if (!document.getElementById('thoughtlands-spinner-style')) {
				const style = document.createElement('style');
				style.id = 'thoughtlands-spinner-style';
				style.textContent = '@keyframes spin { to { transform: rotate(360deg); } }';
				document.head.appendChild(style);
			}
			
			loadingHeader.createEl('strong', { 
				text: 'Creating Region...',
				attr: { style: 'color: var(--text-accent);' }
			});
			
			if (creationStatus.step) {
				loadingSection.createEl('p', { 
					text: creationStatus.step,
					attr: { style: 'margin: 5px 0; font-size: 0.9em; color: var(--text-normal);' }
				});
			}
			
			if (creationStatus.details) {
				loadingSection.createEl('p', { 
					text: creationStatus.details,
					attr: { style: 'margin: 5px 0 0 0; font-size: 0.85em; color: var(--text-muted); font-style: italic;' }
				});
			}
		}

		const regions = this.regionService.getRegions();

		if (regions.length === 0 && !creationStatus.isCreating) {
			const emptyState = containerEl.createDiv({ 
				attr: { style: 'padding: 20px; text-align: center; color: var(--text-muted);' } 
			});
			emptyState.createEl('p', { text: 'No regions created yet.' });
			emptyState.createEl('p', { 
				text: 'Use the buttons above to create your first region.',
				attr: { style: 'font-size: 0.9em; margin-top: 10px;' }
			});
			return;
		}

		const regionsList = containerEl.createDiv({ 
			attr: { 
				style: 'padding: 10px; flex: 1; overflow-y: auto;' 
			} 
		});

		regions.forEach(region => {
			const regionCard = regionsList.createDiv({
				attr: {
					style: 'border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 10px; margin-bottom: 10px;',
				},
			});

			// Region header with color indicator
			const header = regionCard.createDiv({ attr: { style: 'display: flex; align-items: center; margin-bottom: 8px;' } });
			const colorIndicator = header.createDiv({
				attr: {
					style: `width: 16px; height: 16px; background-color: ${region.color}; border-radius: 50%; margin-right: 8px;`,
				},
			});
			header.createEl('strong', { text: region.name });

			// Region info
			const info = regionCard.createDiv({ attr: { style: 'font-size: 0.9em; color: var(--text-muted); margin-bottom: 8px;' } });
			info.createEl('span', { text: `Mode: ${getModeDisplayName(region.mode, region)} • ` });
			info.createEl('span', { text: `${region.notes.length} notes` });

			// Action buttons
			const actions = regionCard.createDiv({ attr: { style: 'display: flex; gap: 5px; margin-top: 8px; flex-wrap: wrap;' } });
			
			const infoButton = actions.createEl('button', { text: 'Info', attr: { style: 'flex: 1; min-width: 80px;' } });
			infoButton.addEventListener('click', () => this.showRegionInfo(region));

			const renameButton = actions.createEl('button', { text: 'Rename', attr: { style: 'flex: 1; min-width: 80px;' } });
			renameButton.addEventListener('click', () => this.renameRegion(region));

			const deleteButton = actions.createEl('button', { text: 'Delete', attr: { style: 'flex: 1; min-width: 80px;' } });
			deleteButton.addEventListener('click', () => this.deleteRegion(region));

			const hasCanvases = (region.canvases && region.canvases.length > 0) || region.canvasPath;
			const canvasButtonText = hasCanvases ? 'Add to Another Canvas' : 'Add to Canvas';
			const canvasButton = actions.createEl('button', { text: canvasButtonText, attr: { style: 'flex: 1; min-width: 80px;' } });
			canvasButton.addEventListener('click', () => this.addToCanvas(region));
		});
	}

	private async renameRegion(region: Region) {
		const newName = prompt('Enter new name:', region.name);
		if (newName && newName.trim() !== '') {
			this.regionService.updateRegion(region.id, { name: newName.trim() });
			this.onRegionUpdate();
			this.render();
		}
	}

	private async deleteRegion(region: Region) {
		if (confirm(`Delete region "${region.name}"?`)) {
			this.regionService.deleteRegion(region.id);
			this.onRegionUpdate();
			this.render();
		}
	}

	private async addToCanvas(region: Region) {
		let isNewCanvas = false;
		const modal = new CanvasSelectModal(
			this.app,
			this.canvasService,
			async (canvasFile: any, wasNew: boolean, drawConnections: boolean) => {
				if (canvasFile) {
					isNewCanvas = wasNew;
					const result = await this.canvasService.addRegionToCanvas(canvasFile, region, isNewCanvas, drawConnections);
					if (result) {
						// Update region with canvas entry
						const existingCanvases = region.canvases || [];
						// Check if this canvas is already in the list
						const existingIndex = existingCanvases.findIndex(c => c.path === result.path);
						const canvasEntry = {
							path: result.path,
							addedAt: new Date().toISOString(),
							isNew: result.isNew
						};
						
						if (existingIndex >= 0) {
							// Update existing entry
							existingCanvases[existingIndex] = canvasEntry;
						} else {
							// Add new entry
							existingCanvases.push(canvasEntry);
						}
						
						// Save to region (also keep canvasPath for backward compatibility)
						this.regionService.updateRegion(region.id, { 
							canvasPath: result.path,
							canvases: existingCanvases
						});
						await this.onRegionUpdate();
						
						const actionText = result.isNew ? 'created and added to' : 'added to';
						new Notice(`Region "${region.name}" ${actionText} canvas "${canvasFile.basename}"`);
						
						// Close the canvas if it's open, then reopen to force reload
						const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
						for (const leaf of canvasLeaves) {
							const view = leaf.view as any;
							if (view?.file?.path === canvasFile.path) {
								await leaf.detach();
							}
						}
						
						// Small delay to ensure file is written
						setTimeout(async () => {
							// Open the canvas file
							await this.app.workspace.openLinkText(canvasFile.path, '', true);
						}, 200);
						
						// Re-render to update button text
						this.render();
					} else {
						new Notice(`Failed to add region to canvas.`);
					}
				}
			},
			region.name // Suggest region name for new canvas
		);
		modal.open();
	}

	private showRegionInfo(region: Region) {
		const modal = new RegionInfoModal(this.app, region);
		modal.open();
	}

	updateSettings(newSettings: ThoughtlandsSettings): void {
		this.settings = newSettings;
		// Re-render to show/hide AI button based on API key
		this.render();
	}
}

