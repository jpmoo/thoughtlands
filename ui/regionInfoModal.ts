import { App, Modal, TFile } from 'obsidian';
import { Region, getModeDisplayName } from '../models/region';

export class RegionInfoModal extends Modal {
	private region: Region;

	constructor(app: App, region: Region) {
		super(app);
		this.region = region;
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
		metadata.createEl('p', { 
			text: `Created: ${new Date(this.region.createdAt).toLocaleString()}`,
			attr: { style: 'margin: 5px 0; font-size: 0.9em; color: var(--text-muted);' }
		});
		metadata.createEl('p', { 
			text: `Notes: ${this.region.notes.length}`,
			attr: { style: 'margin: 5px 0;' }
		});
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
			
			canvases.forEach((canvas, index) => {
				const canvasItem = canvasList.createDiv({ attr: { style: 'margin: 5px 0; padding: 5px; background: var(--background-primary); border-radius: 3px;' } });
				
				// Canvas path link
				const canvasLink = canvasItem.createEl('a', { 
					text: canvas.path,
					attr: { 
						style: 'color: var(--text-accent); cursor: pointer; text-decoration: underline; font-weight: 500;',
						href: '#'
					}
				});
				canvasLink.addEventListener('click', (e) => {
					e.preventDefault();
					this.app.workspace.openLinkText(canvas.path, '', true);
					this.close();
				});
				
				// Status and timestamp
				const statusText = canvas.isNew ? 'new' : 'added';
				const dateTime = new Date(canvas.addedAt).toLocaleString();
				canvasItem.createEl('div', { 
					text: `${statusText} • ${dateTime}`,
					attr: { 
						style: 'font-size: 0.85em; color: var(--text-muted); margin-top: 3px;'
					}
				});
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
						narrativeText.push(`${info.similarNotesFound} note${info.similarNotesFound !== 1 ? 's were' : ' was'} found with semantic similarity above the threshold and added to the region.`);
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

		// Close button
		const buttonContainer = contentEl.createDiv({ attr: { style: 'text-align: right; margin-top: 20px;' } });
		const closeButton = buttonContainer.createEl('button', { text: 'Close' });
		closeButton.addEventListener('click', () => this.close());
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

