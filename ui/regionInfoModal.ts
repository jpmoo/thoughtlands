import { App, Modal, TFile, Notice } from 'obsidian';
import { Region, getModeDisplayName } from '../models/region';
import { RegionService } from '../services/regionService';
import { CreateRegionCommands } from '../commands/createRegionCommands';
import { ThoughtlandsSettings } from '../settings/thoughtlandsSettings';

export class RegionInfoModal extends Modal {
	private region: Region;
	private regionService?: RegionService;
	private createRegionCommands?: CreateRegionCommands;
	private settings?: ThoughtlandsSettings;
	private onUpdate?: () => void;

	constructor(
		app: App, 
		region: Region, 
		regionService?: RegionService, 
		onUpdate?: () => void,
		createRegionCommands?: CreateRegionCommands,
		settings?: ThoughtlandsSettings
	) {
		super(app);
		this.region = region;
		this.regionService = regionService;
		this.createRegionCommands = createRegionCommands;
		this.settings = settings;
		this.onUpdate = onUpdate;
	}

	// Helper to check if region uses semantic similarity (walkabout, etc.)
	private usesSemanticSimilarity(): boolean {
		const info = this.region.source.processingInfo;
		if (!info) return false;
		
		// Semantic similarity mode: has conceptText but no tag analysis (pure semantic similarity)
		if (this.region.mode === 'concept' && info.conceptText && !info.initialTags && !info.refinedTags) {
			return true;
		}
		
		// Search + AI Analysis mode uses grid layout only, not semantic similarity modes
		// AI-assisted tag search (concept mode with tags) uses grid layout only, not semantic similarity modes
		// So we exclude both from this check
		
		return false;
	}

	// Helper to check if region uses semantic similarity filtering (for threshold slider)
	private usesSemanticSimilarityFiltering(): boolean {
		const info = this.region.source.processingInfo;
		if (!info) return false;
		
		// Check if using local model
		const isLocalModel = this.settings?.aiMode === 'local';
		if (!isLocalModel) return false;
		
		// Semantic similarity mode (walkabout, etc.)
		if (this.usesSemanticSimilarity()) {
			return true;
		}
		
		// Search + AI Analysis mode (has embedding filtering)
		if (this.region.mode === 'search' && info.embeddingFiltered) {
			return true;
		}
		
		// AI-assisted tag analysis mode (has embedding filtering)
		if (this.region.mode === 'concept' && info.initialTags && info.embeddingFiltered) {
			return true;
		}
		
		return false;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Header
		const header = contentEl.createDiv({ attr: { style: 'display: flex; align-items: center; margin-bottom: 20px;' } });
		const colorIndicator = header.createDiv({
			attr: {
				style: `width: 20px; height: 20px; background-color: ${this.region.color}; border-radius: 50%; margin-right: 10px;`,
			},
		});
		header.createEl('h2', { text: this.region.name, attr: { style: 'margin: 0;' } });

		// Region metadata
		const metadata = contentEl.createDiv({ attr: { style: 'margin-bottom: 20px; padding: 10px; background: var(--background-secondary); border-radius: 4px;' } });
		metadata.createEl('p', { 
			text: `Mode: ${getModeDisplayName(this.region.mode, this.region)}`,
			attr: { style: 'margin: 5px 0;' }
		});
		
		// Show semantic similarity mode if it exists (only for local model regions)
		const semanticMode = this.region.source.processingInfo?.semanticSimilarityMode;
		if (semanticMode) {
			const modeDisplayNames: Record<string, string> = {
				'walkabout': 'Walkabout',
				'hopscotch': 'Hopscotch',
				'rolling-path': 'Rolling Path',
				'crowd': 'Crowd'
			};
			const modeDisplayName = modeDisplayNames[semanticMode] || semanticMode;
			metadata.createEl('p', { 
				text: `Semantic Similarity Type: ${modeDisplayName}`,
				attr: { style: 'margin: 5px 0;' }
			});
		}
		
		metadata.createEl('p', { 
			text: `Created: ${new Date(this.region.createdAt).toLocaleString()}`,
			attr: { style: 'margin: 5px 0; font-size: 0.9em; color: var(--text-muted);' }
		});
		metadata.createEl('p', { 
			text: `Notes: ${this.region.notes.length}`,
			attr: { style: 'margin: 5px 0;' }
		});

		// Interactive settings section for regions that use semantic similarity filtering
		if (this.usesSemanticSimilarityFiltering()) {
			const settingsSection = metadata.createDiv({ 
				attr: { 
					style: 'margin-top: 15px; padding-top: 15px; border-top: 1px solid var(--background-modifier-border);' 
				} 
			});
			settingsSection.createEl('strong', { 
				text: 'Region Settings', 
				attr: { style: 'display: block; margin-bottom: 10px;' } 
			});

			// Threshold slider section
			const thresholdSection = settingsSection.createDiv({ 
				attr: { style: 'margin-bottom: 10px;' } 
			});
			
			thresholdSection.createEl('label', { 
				text: 'Threshold:',
				attr: { style: 'display: block; margin-bottom: 5px; font-weight: 500;' }
			});
			
			const thresholdSliderContainer = thresholdSection.createDiv({ 
				attr: { style: 'display: flex; align-items: center; gap: 10px;' } 
			});
			
			const thresholdInput = thresholdSliderContainer.createEl('input', {
				type: 'range',
				attr: { 
					style: 'flex: 1;',
					min: '0',
					max: '1',
					step: '0.05',
					value: String(this.region.similarityThreshold ?? this.settings?.embeddingSimilarityThreshold ?? 0.65)
				}
			});
			
			// Value display
			const thresholdValue = thresholdSliderContainer.createEl('span', {
				text: String((this.region.similarityThreshold ?? this.settings?.embeddingSimilarityThreshold ?? 0.65).toFixed(2)),
				attr: { 
					style: 'min-width: 45px; text-align: right; font-weight: 500;' 
				}
			});
			
			// Update value display when slider changes
			thresholdInput.addEventListener('input', (e) => {
				const value = parseFloat((e.target as HTMLInputElement).value);
				thresholdValue.textContent = value.toFixed(2);
			});
			
			// Help text
			thresholdSection.createEl('div', {
				text: 'Higher = More restrictive',
				attr: { style: 'font-size: 0.85em; color: var(--text-muted); margin-top: 5px;' }
			});
			
			// Combined semantic mode setting with rerun button
			const settingsContainer = settingsSection.createDiv({ 
				attr: { style: 'display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 10px;' } 
			});

			// Semantic mode dropdown
			settingsContainer.createEl('label', { 
				text: 'Mode:',
				attr: { style: 'min-width: 60px;' }
			});
			
			const modeSelect = settingsContainer.createEl('select', {
				attr: { 
					style: 'padding: 4px 8px; flex: 1; min-width: 150px;'
				}
			});
			
			const modeOptions: { value: 'walkabout' | 'hopscotch' | 'rolling-path' | 'crowd'; label: string }[] = [
				{ value: 'walkabout', label: 'Walkabout' },
				{ value: 'hopscotch', label: 'Hopscotch' },
				{ value: 'rolling-path', label: 'Rolling Path' },
				{ value: 'crowd', label: 'Crowd' }
			];
			
			const currentMode = this.region.source.processingInfo?.semanticSimilarityMode || 'walkabout';
			modeOptions.forEach(option => {
				const optionEl = modeSelect.createEl('option', {
					text: option.label,
					attr: { value: option.value }
				});
				if (option.value === currentMode) {
					optionEl.selected = true;
				}
			});

			// Re-run button
			const rerunButton = settingsContainer.createEl('button', {
				text: 'Re-run',
				attr: { 
					style: 'padding: 4px 12px; font-size: 0.9em; margin-left: auto;'
				}
			});

			// Disable rerun for semantic similarity regions when using OpenAI (ChatGPT)
			if (this.usesSemanticSimilarity() && this.settings?.aiMode === 'openai') {
				rerunButton.disabled = true;
				rerunButton.setAttribute('title', 'Re-running semantic similarity analysis regions is not supported when using OpenAI');
				rerunButton.style.opacity = '0.5';
				rerunButton.style.cursor = 'not-allowed';
			}

			rerunButton.addEventListener('click', async () => {
				if (!this.createRegionCommands || !this.settings || !this.regionService) {
					new Notice('Cannot re-run: Required services not available');
					return;
				}

				// Disable rerun for semantic similarity regions when using OpenAI (ChatGPT)
				if (this.usesSemanticSimilarity() && this.settings.aiMode === 'openai') {
					new Notice('Re-running semantic similarity analysis regions is not supported when using OpenAI');
					return;
				}

				// Get new threshold from input
				const newThreshold = parseFloat(thresholdInput.value);
				if (isNaN(newThreshold) || newThreshold < 0 || newThreshold > 1) {
					new Notice('Threshold must be between 0 and 1');
					return;
				}

				// Get new semantic mode from dropdown (only for semantic similarity regions)
				let newSemanticMode: 'walkabout' | 'hopscotch' | 'rolling-path' | 'crowd' | undefined;
				if (this.usesSemanticSimilarity() && modeSelect) {
					newSemanticMode = modeSelect.value as 'walkabout' | 'hopscotch' | 'rolling-path' | 'crowd';
					if (!['walkabout', 'hopscotch', 'rolling-path', 'crowd'].includes(newSemanticMode)) {
						new Notice('Invalid semantic mode selected');
						return;
					}
				}

				// Get original values for fallback
				const originalThreshold = this.region.similarityThreshold ?? this.settings.embeddingSimilarityThreshold ?? 0.65;
				const originalSemanticMode = this.region.source.processingInfo?.semanticSimilarityMode || 'walkabout';
				
				// Temporarily update settings with new threshold
				const originalSettingsThreshold = this.settings.embeddingSimilarityThreshold;
				this.settings.embeddingSimilarityThreshold = newThreshold;
				this.createRegionCommands.updateSettings(this.settings);
				
				try {
					// Store old region info to reuse
					const oldName = this.region.name;
					const oldColor = this.region.color;
					const oldRegionId = this.region.id;
					
					// Determine which method to call based on region mode
					let notesFound = false;
					if (this.region.mode === 'concept') {
						const info = this.region.source.processingInfo;
						if (info?.conceptText && !info.initialTags && !info.refinedTags) {
							// Semantic similarity mode - re-run with concept text
							const conceptText = info.conceptText;
							
							// Re-run semantic similarity with new threshold and mode
							new Notice(`Re-running with threshold ${newThreshold.toFixed(2)} and mode ${newSemanticMode}...`);
							notesFound = await this.createRegionCommands.createRegionFromSemanticSimilarityWithParams(
								conceptText,
								oldName,
								oldColor,
								newSemanticMode
							);
							
							if (notesFound) {
								// Delete old region
								this.regionService.deleteRegion(oldRegionId);
							}
						} else if (this.region.source.concepts) {
							// Concept/tag analysis mode - re-run with concepts and new threshold
							// Note: Re-running concept/tag analysis with new threshold requires recreating the region
							// For now, we'll use the existing threshold from the region
							new Notice('Re-running concept/tag analysis with a new threshold is not yet fully supported. Please create a new region.');
							notesFound = false;
						}
					} else if (this.region.mode === 'search') {
						// Search + AI Analysis mode - re-run with new threshold only (no mode selection)
						const query = this.region.source.query;
						
						if (query) {
							// Re-run search with AI analysis using new threshold
							new Notice(`Re-running with threshold ${newThreshold.toFixed(2)}...`);
							notesFound = await this.createRegionCommands.createRegionFromSearchWithAIAnalysisWithParams(
								query,
								oldName,
								oldColor,
								newThreshold
							);
							
							if (notesFound) {
								// Delete old region
								this.regionService.deleteRegion(oldRegionId);
							}
						} else {
							new Notice('Cannot re-run: Search query not available');
						}
					}
					
					if (!notesFound) {
						// No notes found with new values, keep old region and restore values
						new Notice(`No notes found with threshold ${newThreshold.toFixed(2)} and mode ${newSemanticMode}. Keeping original region with threshold ${originalThreshold.toFixed(2)} and mode ${originalSemanticMode}.`);
						this.settings.embeddingSimilarityThreshold = originalSettingsThreshold;
						this.createRegionCommands.updateSettings(this.settings);
					} else {
						// Notes found, update threshold and mode in the new region
						const newRegion = this.regionService.getRegions().find(r => r.name === oldName && r.color === oldColor);
						if (newRegion) {
							// Update processingInfo to reflect new threshold and mode
							if (newRegion.source.processingInfo) {
								newRegion.source.processingInfo.similarityThreshold = newThreshold;
								newRegion.source.processingInfo.semanticSimilarityMode = newSemanticMode;
								this.regionService.updateRegion(newRegion.id, {
									similarityThreshold: newThreshold,
									source: newRegion.source
								});
							} else {
								this.regionService.updateRegion(newRegion.id, {
									similarityThreshold: newThreshold
								});
							}
							
							// Update the local region reference to reflect changes
							this.region = newRegion;
						}
						// Restore original settings threshold
						this.settings.embeddingSimilarityThreshold = originalSettingsThreshold;
						this.createRegionCommands.updateSettings(this.settings);
						
						// Close modal and trigger update
						this.close();
						if (this.onUpdate) {
							await this.onUpdate();
						}
					}
				} catch (error) {
					// Restore original threshold on error
					this.settings.embeddingSimilarityThreshold = originalSettingsThreshold;
					this.createRegionCommands.updateSettings(this.settings);
					console.error('[Thoughtlands] Error re-running region:', error);
					new Notice(`Error re-running region: ${error instanceof Error ? error.message : 'Unknown error'}`);
				}
			});
		}
		// Show canvas information
		let canvases = this.region.canvases || [];
		
		// Backward compatibility: if canvasPath exists but no canvases array, create one
		if (this.region.canvasPath && canvases.length === 0) {
			canvases.push({
				path: this.region.canvasPath,
				addedAt: this.region.updatedAt, // Use updatedAt as fallback
				isNew: false
			});
		}
		
		// Sort canvases by date (most recent first)
		canvases = [...canvases].sort((a, b) => {
			const dateA = new Date(a.addedAt).getTime();
			const dateB = new Date(b.addedAt).getTime();
			return dateB - dateA; // Reverse order (newest first)
		});
		
		if (canvases.length > 0) {
			const canvasSection = metadata.createDiv({ attr: { style: 'margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--background-modifier-border);' } });
			
			// Collapsible header
			const canvasHeader = canvasSection.createDiv({ 
				attr: { 
					style: 'display: flex; align-items: center; cursor: pointer; user-select: none; margin-bottom: 5px;'
				}
			});
			
			// Carat icon (pointing down when open)
			const carat = canvasHeader.createSpan({ 
				text: '▼',
				attr: { 
					style: 'font-size: 0.8em; margin-right: 5px; color: var(--text-muted); transition: transform 0.2s;'
				}
			});
			
			canvasHeader.createEl('strong', { text: `Canvases (${canvases.length}):` });
			
			// Canvas list container (initially visible)
			const canvasList = canvasSection.createDiv({ 
				attr: { 
					style: 'display: block;'
				}
			});
			
			let isExpanded = true;
			
			// Toggle function
			const toggleCanvasList = () => {
				isExpanded = !isExpanded;
				if (isExpanded) {
					canvasList.style.display = 'block';
					carat.textContent = '▼';
				} else {
					canvasList.style.display = 'none';
					carat.textContent = '▶';
				}
			};
			
			canvasHeader.addEventListener('click', toggleCanvasList);
			
			// Check for missing files and add notice/button inside the collapsible list, above the canvas items
			const missingCanvases = canvases.filter(canvas => {
				const canvasFile = this.app.vault.getAbstractFileByPath(canvas.path);
				return !(canvasFile instanceof TFile);
			});
			
			if (missingCanvases.length > 0 && this.regionService) {
				const missingFilesSection = canvasList.createDiv({ 
					attr: { style: 'margin-bottom: 10px; padding: 10px; background: var(--background-modifier-form-field-highlighted); border-radius: 4px;' } 
				});
				
				missingFilesSection.createEl('div', {
					text: `${missingCanvases.length} missing file${missingCanvases.length > 1 ? 's' : ''} found`,
					attr: { style: 'font-weight: 500; margin-bottom: 8px;' }
				});
				
				const removeAllButton = missingFilesSection.createEl('button', {
					text: 'Remove All Missing Files',
					attr: {
						style: 'padding: 6px 12px; font-size: 0.9em;'
					}
				});
				
				removeAllButton.addEventListener('click', async () => {
					if (confirm(`Remove all ${missingCanvases.length} missing file${missingCanvases.length > 1 ? 's' : ''} from this region's canvas list?`)) {
						if (!this.regionService) return;
						
						// Remove all missing canvases
						const updatedCanvases = canvases.filter(canvas => {
							const canvasFile = this.app.vault.getAbstractFileByPath(canvas.path);
							return canvasFile instanceof TFile;
						});
						
						// Clear canvasPath if it's missing
						const canvasPathFile = this.region.canvasPath 
							? this.app.vault.getAbstractFileByPath(this.region.canvasPath)
							: null;
						const updatedCanvasPath = (canvasPathFile instanceof TFile) ? this.region.canvasPath : undefined;
						
						this.regionService.updateRegion(this.region.id, {
							canvases: updatedCanvases,
							canvasPath: updatedCanvasPath
						});
						
						// Update the region reference
						this.region.canvases = updatedCanvases;
						if (updatedCanvasPath === undefined) {
							delete this.region.canvasPath;
						}
						
						// Trigger update callback if provided
						if (this.onUpdate) {
							this.onUpdate();
						}
						
						// Re-render the modal
						this.onOpen();
						
						new Notice(`Removed ${missingCanvases.length} missing file${missingCanvases.length > 1 ? 's' : ''} from region`);
					}
				});
			}
			
			canvases.forEach((canvas, index) => {
				const canvasItem = canvasList.createDiv({ attr: { style: 'margin: 5px 0; padding: 5px; background: var(--background-primary); border-radius: 3px; display: flex; align-items: center; justify-content: space-between;' } });
				
				const leftSection = canvasItem.createDiv({ attr: { style: 'flex: 1;' } });
				
				// Check if canvas file exists
				const canvasFile = this.app.vault.getAbstractFileByPath(canvas.path);
				const fileExists = canvasFile instanceof TFile;
				
				// Canvas path link
				const canvasLink = leftSection.createEl('a', { 
					text: canvas.path,
					attr: { 
						style: fileExists 
							? 'color: var(--text-accent); cursor: pointer; text-decoration: underline; font-weight: 500;'
							: 'color: var(--text-muted); cursor: not-allowed; text-decoration: line-through; font-weight: 500; opacity: 0.6;',
						href: '#'
					}
				});
				
				if (fileExists) {
					canvasLink.addEventListener('click', (e) => {
						e.preventDefault();
						this.app.workspace.openLinkText(canvas.path, '', true);
						this.close();
					});
				} else {
					canvasLink.addEventListener('click', (e) => {
						e.preventDefault();
						// Do nothing - file doesn't exist
					});
				}
				
				// Status and timestamp
				const statusText = canvas.isNew ? 'new' : 'added';
				const dateTime = new Date(canvas.addedAt).toLocaleString();
				const statusDiv = leftSection.createEl('div', { 
					text: `${statusText} • ${dateTime}${!fileExists ? ' • (file missing)' : ''}`,
					attr: { 
						style: `font-size: 0.85em; color: var(--text-muted); margin-top: 3px; ${!fileExists ? 'opacity: 0.6;' : ''}`
					}
				});
				
				// Add remove button if file doesn't exist
				if (!fileExists && this.regionService) {
					const removeButton = canvasItem.createEl('button', {
						text: 'Remove',
						attr: {
							style: 'padding: 4px 8px; font-size: 0.85em; margin-left: 10px;'
						}
					});
					
					removeButton.addEventListener('click', async (e) => {
						e.preventDefault();
						e.stopPropagation();
						
						if (!this.regionService) return;
						
						if (confirm(`Remove "${canvas.path}" from this region's canvas list?`)) {
							// Remove canvas from region
							const updatedCanvases = (this.region.canvases || []).filter(c => c.path !== canvas.path);
							
							// Also clear canvasPath if it matches
							const updatedCanvasPath = this.region.canvasPath === canvas.path ? undefined : this.region.canvasPath;
							
							this.regionService.updateRegion(this.region.id, {
								canvases: updatedCanvases,
								canvasPath: updatedCanvasPath
							});
							
							// Update the region reference
							this.region.canvases = updatedCanvases;
							if (updatedCanvasPath === undefined) {
								delete this.region.canvasPath;
							}
							
							// Trigger update callback if provided
							if (this.onUpdate) {
								this.onUpdate();
							}
							
							// Re-render the modal
							this.onOpen();
							
							new Notice(`Removed "${canvas.path}" from region`);
						}
					});
				}
			});
		}

		// Source information based on mode
		const sourceSection = contentEl.createDiv({ attr: { style: 'margin-bottom: 20px;' } });
		sourceSection.createEl('h3', { text: 'Source Information', attr: { style: 'margin-bottom: 10px;' } });

		if (this.region.mode === 'concept' && this.region.source.concepts) {
			const conceptsDiv = sourceSection.createDiv({ attr: { style: 'margin-bottom: 15px;' } });
			conceptsDiv.createEl('strong', { text: 'Concept Entered:' });
			const conceptText = this.region.source.concepts.length === 1 
				? this.region.source.concepts[0]
				: this.region.source.concepts.join(', ');
			conceptsDiv.createEl('p', { 
				text: conceptText,
				attr: { style: 'margin: 5px 0; padding: 8px; background: var(--background-secondary); border-radius: 4px;' }
			});

			// Tags returned by AI (stored when region was created)
			if (this.region.source.tags && this.region.source.tags.length > 0) {
				const tagsDiv = sourceSection.createDiv({ attr: { style: 'margin-bottom: 15px;' } });
				tagsDiv.createEl('strong', { text: 'Tags Returned by AI:' });
				const tagsList = tagsDiv.createEl('ul', { attr: { style: 'margin: 5px 0; padding-left: 20px;' } });
				this.region.source.tags.forEach(tag => {
					tagsList.createEl('li', { text: `#${tag}` });
				});
			}

			// Processing narrative (collapsible, default closed)
			if (this.region.source.processingInfo) {
				const narrativeSection = contentEl.createDiv({ 
					attr: { style: 'margin-bottom: 20px; padding: 10px; background: var(--background-secondary); border-radius: 4px;' } 
				});

				// Collapsible header
				const narrativeHeader = narrativeSection.createDiv({ 
					attr: { 
						style: 'display: flex; align-items: center; cursor: pointer; user-select: none; margin-bottom: 5px;'
					}
				});
				
				// Carat icon (pointing right when closed)
				const carat = narrativeHeader.createSpan({ 
					text: '▶',
					attr: { 
						style: 'font-size: 0.8em; margin-right: 5px; color: var(--text-muted); transition: transform 0.2s;'
					}
				});
				
				narrativeHeader.createEl('strong', { text: 'Processing Narrative' });
				
				// Narrative content container (initially hidden)
				const narrativeContent = narrativeSection.createDiv({ 
					attr: { 
						style: 'display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--background-modifier-border);'
					}
				});
				
				let isExpanded = false;
				
				// Toggle function
				const toggleNarrative = () => {
					isExpanded = !isExpanded;
					if (isExpanded) {
						narrativeContent.style.display = 'block';
						carat.textContent = '▼';
					} else {
						narrativeContent.style.display = 'none';
						carat.textContent = '▶';
					}
				};
				
				narrativeHeader.addEventListener('click', toggleNarrative);

				const info = this.region.source.processingInfo;
				const narrativeText: string[] = [];

				// Check if this is semantic similarity (has conceptText but no tag analysis)
				if (info.conceptText && !info.initialTags && !info.refinedTags) {
					// Semantic Similarity Analysis narrative
					narrativeText.push(`An embedding was generated for the concept: "${info.conceptText}".`);
					
					if (info.similarNotesFound !== undefined) {
						const threshold = info.similarityThreshold ?? 0.7;
						narrativeText.push(`Semantic similarity analysis was performed across all notes in the vault using a similarity threshold of ${threshold}.`);
						
						const semanticMode = info.semanticSimilarityMode || 'walkabout';
						const modeDescriptions: Record<string, string> = {
							'walkabout': 'All semantically similar notes were selected. When added to a canvas, they will be arranged around the concept with distance reflecting similarity. Notes with similar meanings will be clustered together.',
							'hopscotch': 'A path of notes was selected starting with the concept, then the most semantically similar note, then the note most similar to that, and so on. When added to a canvas, this creates a connected chain of related ideas from left to right.',
							'rolling-path': 'A path of notes was selected that aggregates all notes at each step, finding the note most similar to the entire aggregation next. When added to a canvas, this builds a comprehensive exploration of related concepts from left to right.',
							'crowd': 'All semantically similar notes were selected. When added to a canvas, they will be placed in a grid layout with no particular arrangement or clustering.'
						};
						
						const modeDescription = modeDescriptions[semanticMode] || modeDescriptions['walkabout'];
						narrativeText.push(`${info.similarNotesFound} note${info.similarNotesFound !== 1 ? 's were' : ' was'} found with semantic similarity above the threshold. ${modeDescription}`);
					}
				} else {
					// Tag-based concept analysis narrative (existing logic)
					// Get the final tags that are actually displayed (after all filtering)
					const finalDisplayedTags = this.region.source.tags || [];
					const finalDisplayedCount = finalDisplayedTags.length;
					
					// The count before excerpt analysis - this is what we want to show
					const beforeExcerptAnalysisCount = info.initialTags?.length || 0;

					// Step 1: Initial tags
					const actualInitialCount = info.initialTags?.length || 0;
					if (info.initialTags && info.initialTags.length > 0) {
						const rawInitialCount = info.initialTagsCount || actualInitialCount;
						
						const conceptText = this.region.source.concepts?.length === 1 
							? this.region.source.concepts[0]
							: this.region.source.concepts?.join(', ') || '';
						narrativeText.push(`The AI was first asked to suggest tags related to the concept "${conceptText}".`);
						
						if (rawInitialCount > actualInitialCount) {
							narrativeText.push(`It suggested ${rawInitialCount} tag${rawInitialCount !== 1 ? 's' : ''}, but ${rawInitialCount - actualInitialCount} were invalid (not in your vault) and were filtered out, leaving ${actualInitialCount} valid tag${actualInitialCount !== 1 ? 's' : ''}.`);
						} else {
							narrativeText.push(`It returned ${actualInitialCount} valid tag${actualInitialCount !== 1 ? 's' : ''}.`);
						}
					}

					// Step 2: Refinement with note excerpts
					if (info.refinedTags && info.refinedTags.length > 0) {
						const actualRefinedCount = info.refinedTags.length;
						const rawRefinedCount = info.refinedTagsCount || actualRefinedCount;
						const removedByRefinement = beforeExcerptAnalysisCount - actualRefinedCount;
						const addedByRefinement = actualRefinedCount - beforeExcerptAnalysisCount;
						
						if (rawRefinedCount > actualRefinedCount) {
							narrativeText.push(`The AI then reviewed sample excerpts from notes and refined the selection to ${rawRefinedCount} tag${rawRefinedCount !== 1 ? 's' : ''}, but ${rawRefinedCount - actualRefinedCount} were invalid and filtered out, leaving ${actualRefinedCount} valid tag${actualRefinedCount !== 1 ? 's' : ''}.`);
						} else if (addedByRefinement > 0) {
							// Tags were added during refinement
							narrativeText.push(`The AI then reviewed sample excerpts from notes with these tags and expanded the selection to ${actualRefinedCount} most relevant tag${actualRefinedCount !== 1 ? 's' : ''}, adding ${addedByRefinement} additional relevant tag${addedByRefinement !== 1 ? 's' : ''} based on the note content.`);
						} else if (removedByRefinement > 0) {
							narrativeText.push(`The AI then reviewed sample excerpts from notes with these tags and refined the selection to ${actualRefinedCount} most relevant tag${actualRefinedCount !== 1 ? 's' : ''}, removing ${removedByRefinement} tag${removedByRefinement !== 1 ? 's' : ''} that were less directly relevant.`);
						} else if (actualRefinedCount < beforeExcerptAnalysisCount) {
							narrativeText.push(`The AI then reviewed sample excerpts from notes with these tags and refined the selection to ${actualRefinedCount} most relevant tag${actualRefinedCount !== 1 ? 's' : ''}.`);
						} else {
							narrativeText.push(`The AI then reviewed sample excerpts from notes with these tags to confirm their relevance.`);
						}
						
						// Show if any tags were removed by ignore filtering
						if (finalDisplayedCount !== actualRefinedCount) {
							const ignoredCount = actualRefinedCount - finalDisplayedCount;
							if (ignoredCount > 0) {
								narrativeText.push(`After filtering by ignore settings, ${finalDisplayedCount} tag${finalDisplayedCount !== 1 ? 's were' : ' was'} used in the final region (${ignoredCount} tag${ignoredCount !== 1 ? 's were' : ' was'} ignored by your settings).`);
							}
						}
					} else if (beforeExcerptAnalysisCount > 0) {
						// If we have initial tags but no refined tags, show what happened
						if (finalDisplayedCount !== beforeExcerptAnalysisCount) {
							const removedCount = beforeExcerptAnalysisCount - finalDisplayedCount;
							narrativeText.push(`After filtering, ${finalDisplayedCount} tag${finalDisplayedCount !== 1 ? 's were' : ' was'} used in the final region (${removedCount} tag${removedCount !== 1 ? 's were' : ' was'} removed).`);
						} else {
							narrativeText.push(`${beforeExcerptAnalysisCount} tag${beforeExcerptAnalysisCount !== 1 ? 's were' : ' was'} used in the final region.`);
						}
					}

					// Step 3: Embedding analysis
					if (info.embeddingFiltered) {
						if (info.notesBeforeEmbedding !== undefined && info.notesBeforeEmbedding > 0) {
							narrativeText.push(`Semantic similarity analysis was then applied to ${info.notesBeforeEmbedding} note${info.notesBeforeEmbedding !== 1 ? 's' : ''} found with the selected tags.`);
						}
						if (info.embeddingRemovedCount && info.embeddingRemovedCount > 0) {
							const threshold = info.similarityThreshold ?? 0.7;
							narrativeText.push(`${info.embeddingRemovedCount} note${info.embeddingRemovedCount !== 1 ? 's were' : ' was'} removed because ${info.embeddingRemovedCount !== 1 ? 'their semantic similarity scores were' : 'its semantic similarity score was'} below the threshold of ${threshold}.`);
						}
						if (info.embeddingAddedCount && info.embeddingAddedCount > 0) {
							narrativeText.push(`Additionally, ${info.embeddingAddedCount} semantically similar note${info.embeddingAddedCount !== 1 ? 's were' : ' was'} found and added that didn't have the suggested tags but matched the concepts semantically.`);
						} else if (info.embeddingRemovedCount === 0 && info.notesBeforeEmbedding !== undefined && info.notesBeforeEmbedding > 0) {
							narrativeText.push(`All notes met the semantic similarity threshold and were kept.`);
						}
					} else if (info.notesBeforeEmbedding !== undefined) {
						narrativeText.push(`Embedding-based filtering was not applied (embeddings not available or not using local model).`);
					}
				}

				// Display narrative
				narrativeText.forEach((text, index) => {
					const para = narrativeContent.createEl('p', {
						text: text,
						attr: { style: `margin: ${index === 0 ? '0' : '8px'} 0; line-height: 1.5;` }
					});
				});
			}
		} else if (this.region.mode === 'search') {
			if (this.region.source.query) {
				sourceSection.createEl('p', { 
					text: `Search Query: ${this.region.source.query}`,
					attr: { style: 'margin: 5px 0;' }
				});
			} else {
				sourceSection.createEl('p', { 
					text: 'Search Query: (not available)',
					attr: { style: 'margin: 5px 0; color: var(--text-muted);' }
				});
			}

			// Processing narrative for Search + AI Analysis (collapsible, default closed)
			if (this.region.source.processingInfo) {
				const narrativeSection = contentEl.createDiv({ 
					attr: { style: 'margin-bottom: 20px; padding: 10px; background: var(--background-secondary); border-radius: 4px;' } 
				});

				// Collapsible header
				const narrativeHeader = narrativeSection.createDiv({ 
					attr: { 
						style: 'display: flex; align-items: center; cursor: pointer; user-select: none; margin-bottom: 5px;'
					}
				});
				
				// Carat icon (pointing right when closed)
				const carat = narrativeHeader.createSpan({ 
					text: '▶',
					attr: { 
						style: 'font-size: 0.8em; margin-right: 5px; color: var(--text-muted); transition: transform 0.2s;'
					}
				});
				
				narrativeHeader.createEl('strong', { text: 'Processing Narrative' });
				
				// Narrative content container (initially hidden)
				const narrativeContent = narrativeSection.createDiv({ 
					attr: { 
						style: 'display: none; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--background-modifier-border);'
					}
				});
				
				let isExpanded = false;
				
				// Toggle function
				const toggleNarrative = () => {
					isExpanded = !isExpanded;
					if (isExpanded) {
						narrativeContent.style.display = 'block';
						carat.textContent = '▼';
					} else {
						narrativeContent.style.display = 'none';
						carat.textContent = '▶';
					}
				};
				
				narrativeHeader.addEventListener('click', toggleNarrative);

				const info = this.region.source.processingInfo;
				const narrativeText: string[] = [];

				// Build narrative for Search + AI Analysis
				if (info.searchResultsCount !== undefined) {
					narrativeText.push(`Found ${info.searchResultsCount} note${info.searchResultsCount !== 1 ? 's' : ''} from the search results.`);
				}

				if (info.searchResultsWithEmbeddings !== undefined && info.searchResultsCount !== undefined) {
					if (info.searchResultsWithEmbeddings < info.searchResultsCount) {
						narrativeText.push(`Of these, ${info.searchResultsWithEmbeddings} had embeddings available for analysis.`);
					} else {
						narrativeText.push(`All search results had embeddings available for analysis.`);
					}
				}

				if (info.similarNotesFound !== undefined && info.similarNotesFound > 0) {
					const threshold = info.similarityThreshold ?? 0.7;
					narrativeText.push(`Using semantic similarity analysis (threshold: ${threshold}), ${info.similarNotesFound} additional related note${info.similarNotesFound !== 1 ? 's were' : ' was'} found and added to the region.`);
				} else if (info.similarNotesFound === 0) {
					narrativeText.push(`Semantic similarity analysis was applied, but no additional related notes were found above the similarity threshold.`);
				}

				// Display narrative
				narrativeText.forEach((text, index) => {
					const para = narrativeContent.createEl('p', {
						text: text,
						attr: { style: `margin: ${index === 0 ? '0' : '8px'} 0; line-height: 1.5;` }
					});
				});
			}
		}

		// Notes list
		const notesSection = contentEl.createDiv();
		notesSection.createEl('h3', { text: 'Matching Notes', attr: { style: 'margin-bottom: 10px;' } });

		if (this.region.notes.length === 0) {
			notesSection.createEl('p', { 
				text: 'No notes found.',
				attr: { style: 'color: var(--text-muted);' }
			});
		} else {
			const notesList = notesSection.createDiv({ 
				attr: { style: 'max-height: 400px; overflow-y: auto; border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 10px;' } 
			});
			
			this.region.notes.forEach((notePath, index) => {
				const noteItem = notesList.createDiv({ 
					attr: { 
						style: 'padding: 5px; margin-bottom: 5px; border-bottom: 1px solid var(--background-modifier-border); cursor: pointer;' 
					} 
				});
				
				// Make note clickable to open it
				noteItem.style.cursor = 'pointer';
				noteItem.addEventListener('click', () => {
					const file = this.app.vault.getAbstractFileByPath(notePath);
					if (file instanceof TFile) {
						this.app.workspace.openLinkText(notePath, '', true);
						this.close();
					}
				});
				
				noteItem.addEventListener('mouseenter', () => {
					noteItem.style.backgroundColor = 'var(--background-modifier-hover)';
				});
				noteItem.addEventListener('mouseleave', () => {
					noteItem.style.backgroundColor = 'transparent';
				});

				noteItem.createEl('span', { 
					text: notePath,
					attr: { style: 'font-family: monospace; font-size: 0.9em;' }
				});
			});
		}

		// Action buttons
		const buttonContainer = contentEl.createDiv({ attr: { style: 'display: flex; justify-content: space-between; align-items: center; margin-top: 20px; gap: 10px;' } });
		
		const leftButtons = buttonContainer.createDiv({ attr: { style: 'display: flex; gap: 10px;' } });
		
		// Archive/Unarchive button
		if (this.region.archived) {
			const unarchiveButton = leftButtons.createEl('button', { text: 'Unarchive' });
			unarchiveButton.addEventListener('click', () => {
				if (this.regionService) {
					this.regionService.unarchiveRegion(this.region.id);
					if (this.onUpdate) {
						this.onUpdate();
					}
					this.close();
				}
			});
		} else {
			const archiveButton = leftButtons.createEl('button', { text: 'Archive' });
			archiveButton.addEventListener('click', () => {
				if (confirm(`Archive region "${this.region.name}"?`)) {
					if (this.regionService) {
						this.regionService.archiveRegion(this.region.id);
						if (this.onUpdate) {
							this.onUpdate();
						}
						this.close();
					}
				}
			});
		}
		
		// Delete button
		const deleteButton = leftButtons.createEl('button', { 
			text: 'Delete',
			attr: { style: 'color: var(--text-error);' }
		});
		deleteButton.addEventListener('click', () => {
			if (confirm(`Delete region "${this.region.name}"? This cannot be undone.`)) {
				if (this.regionService) {
					this.regionService.deleteRegion(this.region.id);
					if (this.onUpdate) {
						this.onUpdate();
					}
					this.close();
				}
			}
		});
		
		// Close button
		const closeButton = buttonContainer.createEl('button', { text: 'Close' });
		closeButton.addEventListener('click', () => this.close());
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

