import { App, TFile, Workspace, Notice } from 'obsidian';
import { RegionService } from '../services/regionService';
import { NoteService } from '../services/noteService';
import { OpenAIService } from '../services/openAIService';
import { LocalAIService } from '../services/localAIService';
import { EmbeddingService } from '../services/embeddingService';
import { Region } from '../models/region';
import { ThoughtlandsSettings } from '../settings/thoughtlandsSettings';
import { SimplePromptModal } from '../ui/simplePromptModal';
import { ColorPickerModal } from '../ui/colorPickerModal';
import { ConceptInputModal, ConceptScope } from '../ui/conceptInputModal';

export class CreateRegionCommands {
	private app: App;
	private regionService: RegionService;
	private noteService: NoteService;
	private openAIService: OpenAIService;
	private localAIService: LocalAIService;
	private embeddingService: EmbeddingService;
	private settings: ThoughtlandsSettings;

	constructor(
		app: App,
		regionService: RegionService,
		noteService: NoteService,
		openAIService: OpenAIService,
		localAIService: LocalAIService,
		embeddingService: EmbeddingService,
		settings: ThoughtlandsSettings
	) {
		this.app = app;
		this.regionService = regionService;
		this.noteService = noteService;
		this.openAIService = openAIService;
		this.localAIService = localAIService;
		this.embeddingService = embeddingService;
		this.settings = settings;
	}

	updateSettings(newSettings: ThoughtlandsSettings): void {
		this.settings = newSettings;
	}

	async createRegionFromSearch(): Promise<void> {
		// Get active search results
		const searchResults = this.getActiveSearchResults();
		
		if (searchResults.length === 0) {
			new Notice('No search results found. Please perform a search first.');
			return;
		}

		// Filter by ignored paths
		const filteredResults = this.regionService.filterNotesByIgnores(searchResults);

		// Prompt for name and color
		const name = await this.promptForName();
		if (!name) return;

		const color = await this.promptForColor();
		if (!color) return;

		// Create region
		const notePaths = filteredResults.map(file => file.path);
		const region = this.regionService.createRegion(
			name,
			color,
			'search',
			{
				type: 'search',
				query: '', // Could extract from search if available
			},
			notePaths
		);

		new Notice(`Region "${name}" created with ${notePaths.length} notes.`);
	}

	async createRegionFromSearchWithTags(): Promise<void> {
		// Get active search results
		const searchResults = this.getActiveSearchResults();
		
		if (searchResults.length === 0) {
			new Notice('No search results found. Please perform a search first.');
			return;
		}

		// Filter by ignored paths
		const filteredResults = this.regionService.filterNotesByIgnores(searchResults);

		// Get all tags from search results
		const tags = this.noteService.getTagsFromNotes(filteredResults);
		const filteredTags = this.regionService.filterTagsByIgnores(tags);

		if (filteredTags.length === 0) {
			new Notice('No tags found in search results.');
			return;
		}

		// Expand to all notes with those tags
		const expandedNotes = this.noteService.getNotesByTags(filteredTags);
		const finalNotes = this.regionService.filterNotesByIgnores(expandedNotes);

		// Prompt for name and color
		const name = await this.promptForName();
		if (!name) return;

		const color = await this.promptForColor();
		if (!color) return;

		// Create region
		const notePaths = finalNotes.map(file => file.path);
		const region = this.regionService.createRegion(
			name,
			color,
			'search+tags',
			{
				type: 'tags',
				tags: filteredTags,
			},
			notePaths
		);

		new Notice(`Region "${name}" created with ${notePaths.length} notes from ${filteredTags.length} tags.`);
	}

	async createRegionFromConcept(): Promise<void> {
		// Prompt for concepts and scope
		const conceptInput = await this.promptForConceptsWithScope();
		if (!conceptInput || conceptInput.concepts.length === 0) {
			console.log('[Thoughtlands] No concepts input provided');
			return;
		}

		const { concepts, scope } = conceptInput;
		console.log('[Thoughtlands] Concepts received:', concepts, 'Scope:', scope);

		// Step 1: Get initial tag suggestions from AI (OpenAI or Local)
		const useLocal = this.settings.aiMode === 'local';
		new Notice(useLocal ? 'Querying local AI for related tags...' : 'Querying AI for related tags...');
		console.log('[Thoughtlands] Querying', useLocal ? 'Local AI' : 'OpenAI', 'for tags related to concepts:', concepts, 'with scope:', scope);

		const initialAiResponse = useLocal
			? await this.localAIService.getRelatedTags(concepts, scope)
			: await this.openAIService.getRelatedTags(concepts, scope);
		
		console.log('[Thoughtlands] Initial OpenAI response:', {
			success: initialAiResponse.success,
			tagsCount: initialAiResponse.tags?.length || 0,
			tags: initialAiResponse.tags,
			error: initialAiResponse.error
		});

		if (!initialAiResponse.success || !initialAiResponse.tags || initialAiResponse.tags.length === 0) {
			console.error('[Thoughtlands] Initial OpenAI query failed:', initialAiResponse.error);
			new Notice(initialAiResponse.error || 'Failed to get related tags from AI.');
			return;
		}

		// Step 2: Gather samples from notes with the suggested tags
		new Notice('Gathering context from notes...');
		const tagSamples = await this.noteService.getTagSamples(initialAiResponse.tags, 3);
		console.log('[Thoughtlands] Collected tag samples for', tagSamples.size, 'tags');

		// Step 3: Filter tags by relevance using the samples
		new Notice('Refining tag selection...');
		const maxTags = this.getMaxTagsForScope(scope);
		const aiResponse = useLocal
			? await this.localAIService.filterTagsByRelevance(concepts, initialAiResponse.tags, tagSamples, maxTags)
			: await this.openAIService.filterTagsByRelevance(concepts, initialAiResponse.tags, tagSamples, maxTags);
		
		console.log('[Thoughtlands] OpenAI response:', {
			success: aiResponse.success,
			tagsCount: aiResponse.tags?.length || 0,
			tags: aiResponse.tags,
			error: aiResponse.error
		});

		if (!aiResponse.success || !aiResponse.tags || aiResponse.tags.length === 0) {
			console.error('[Thoughtlands] OpenAI query failed:', aiResponse.error);
			new Notice(aiResponse.error || 'Failed to get related tags from AI.');
			return;
		}

		// Filter tags by ignores
		const filteredTags = this.regionService.filterTagsByIgnores(aiResponse.tags);
		console.log('[Thoughtlands] Tags after filtering ignores:', {
			originalCount: aiResponse.tags.length,
			filteredCount: filteredTags.length,
			originalTags: aiResponse.tags,
			filteredTags: filteredTags,
			ignoredTags: this.settings.ignoredTags
		});

		if (filteredTags.length === 0) {
			console.warn('[Thoughtlands] All suggested tags were filtered out by ignore list');
			new Notice('All suggested tags were filtered out.');
			return;
		}

		// Get all notes with those tags
		console.log('[Thoughtlands] Searching for notes with tags:', filteredTags);
		const notes = this.noteService.getNotesByTags(filteredTags);
		console.log('[Thoughtlands] Notes found before path filtering:', notes.length, notes.map(n => n.path));

		const finalNotes = this.regionService.filterNotesByIgnores(notes);
		console.log('[Thoughtlands] Notes found after path filtering:', {
			beforeFilter: notes.length,
			afterFilter: finalNotes.length,
			finalNotes: finalNotes.map(n => n.path),
			ignoredPaths: this.settings.ignoredPaths
		});

		if (finalNotes.length === 0) {
			console.warn('[Thoughtlands] No notes found with suggested tags. Debug info:', {
				searchTags: filteredTags,
				notesBeforeFilter: notes.length,
				notesAfterFilter: finalNotes.length
			});
			new Notice('No notes found with the suggested tags.');
			return;
		}

		// Generate region name using AI
		new Notice('Generating region name...');
		console.log('[Thoughtlands] Generating region name for concepts:', concepts);
		const nameResponse = useLocal
			? await this.localAIService.generateRegionName(concepts, filteredTags)
			: await this.openAIService.generateRegionName(concepts, filteredTags);
		
		let suggestedName = '';
		if (nameResponse.success && nameResponse.name) {
			suggestedName = nameResponse.name;
			console.log('[Thoughtlands] AI suggested name:', suggestedName);
		} else {
			console.warn('[Thoughtlands] Failed to generate name, using fallback:', nameResponse.error);
			// Fallback: create a name from concepts
			suggestedName = concepts.slice(0, 3).map(c => c.charAt(0).toUpperCase() + c.slice(1)).join(' & ');
		}

		// Prompt for name (pre-filled with AI suggestion) and color
		const name = await this.promptForName(suggestedName);
		if (!name) return;

		const color = await this.promptForColor();
		if (!color) return;

		// Create region
		const notePaths = finalNotes.map(file => file.path);
		const region = this.regionService.createRegion(
			name,
			color,
			'concept',
			{
				type: 'concept',
				concepts: concepts,
				tags: filteredTags, // Store the tags returned by AI
			},
			notePaths
		);

		console.log('[Thoughtlands] Region created successfully:', {
			name: name,
			color: color,
			mode: 'concept',
			concepts: concepts,
			noteCount: notePaths.length,
			notes: notePaths
		});
		new Notice(`Region "${name}" created with ${notePaths.length} notes from AI-suggested tags.`);
	}

	private getActiveSearchResults(): TFile[] {
		const results: TFile[] = [];
		
		console.log('[Thoughtlands] Attempting to get search results...');
		
		// Method 1: Get all search view leaves
		const searchLeaves = this.app.workspace.getLeavesOfType('search');
		console.log('[Thoughtlands] Found', searchLeaves.length, 'search view leaves');
		
		for (const leaf of searchLeaves) {
			const view = leaf.view as any;
			if (!view) {
				console.log('[Thoughtlands] View is null for leaf');
				continue;
			}

			console.log('[Thoughtlands] Inspecting search view:', {
				hasResultDomLookup: !!view.resultDomLookup,
				hasSearchResults: !!view.searchResults,
				hasGetResults: typeof view.getResults === 'function',
				hasDom: !!view.dom,
				viewKeys: Object.keys(view).slice(0, 20) // First 20 keys for debugging
			});

			// Try resultDomLookup first (most common method)
			if (view.resultDomLookup && typeof view.resultDomLookup === 'object') {
				const filePaths = Object.keys(view.resultDomLookup);
				console.log('[Thoughtlands] Found', filePaths.length, 'files in resultDomLookup');
				for (const filePath of filePaths) {
					const tFile = this.app.vault.getAbstractFileByPath(filePath);
					if (tFile instanceof TFile && !results.find(r => r.path === tFile.path)) {
						results.push(tFile);
					}
				}
			}

			// Try searchResults array
			if (view.searchResults && Array.isArray(view.searchResults)) {
				console.log('[Thoughtlands] Found', view.searchResults.length, 'results in searchResults array');
				for (const result of view.searchResults) {
					if (result && result.file instanceof TFile && !results.find(r => r.path === result.file.path)) {
						results.push(result.file);
					}
				}
			}

			// Try getResults() method if available
			if (typeof view.getResults === 'function') {
				try {
					const searchResults = view.getResults();
					console.log('[Thoughtlands] getResults() returned:', searchResults);
					if (Array.isArray(searchResults)) {
						for (const result of searchResults) {
							if (result && result.file instanceof TFile && !results.find(r => r.path === result.file.path)) {
								results.push(result.file);
							}
						}
					}
				} catch (e) {
					console.log('[Thoughtlands] getResults() method failed:', e);
				}
			}

			// Try accessing results through contentEl or containerEl
			if (view.contentEl && typeof view.contentEl.querySelectorAll === 'function') {
				try {
					const resultElements = view.contentEl.querySelectorAll('.search-result-file-title, .tree-item-inner');
					console.log('[Thoughtlands] Found', resultElements.length, 'result elements in contentEl');
					for (const element of resultElements) {
						const filePath = element.getAttribute('data-path') || element.getAttribute('href')?.replace(/^.*\//, '') || element.textContent?.trim();
						if (filePath) {
							// Try to resolve the file path
							let tFile = this.app.vault.getAbstractFileByPath(filePath);
							if (!tFile && !filePath.endsWith('.md')) {
								tFile = this.app.vault.getAbstractFileByPath(`${filePath}.md`);
							}
							if (tFile instanceof TFile && !results.find(r => r.path === tFile!.path)) {
								results.push(tFile);
							}
						}
					}
				} catch (e) {
					console.log('[Thoughtlands] Error accessing contentEl:', e);
				}
			}

			// Try accessing through containerEl
			if (view.containerEl && typeof view.containerEl.querySelectorAll === 'function') {
				try {
					// Try to find tree-item elements with data-path (these contain the file paths)
					const treeItems = view.containerEl.querySelectorAll('.tree-item[data-path]');
					if (treeItems && treeItems.length > 0) {
						console.log('[Thoughtlands] Found', treeItems.length, 'tree-item elements with data-path');
						const elementsArray = Array.from(treeItems) as Element[];
						for (const element of elementsArray) {
							const filePath = element.getAttribute('data-path');
							if (filePath) {
								let tFile = this.app.vault.getAbstractFileByPath(filePath);
								if (tFile instanceof TFile && !results.find(r => r.path === tFile!.path)) {
									results.push(tFile);
									console.log('[Thoughtlands] Successfully extracted file from tree-item:', tFile.path);
								}
							}
						}
					}
					
					// Fallback: Try search-result-file-title and look for parent tree-item
					if (results.length === 0) {
						const selectors = [
							'.search-result-file-title',
							'.tree-item-inner',
							'.tree-item'
						];
						
						let resultElements: NodeListOf<Element> | null = null;
						for (const selector of selectors) {
							resultElements = view.containerEl.querySelectorAll(selector);
							if (resultElements && resultElements.length > 0) {
								console.log('[Thoughtlands] Found', resultElements.length, 'result elements in containerEl using selector:', selector);
								break;
							}
						}
						
						if (resultElements && resultElements.length > 0) {
							// Convert NodeList to Array for iteration
							const elementsArray = Array.from(resultElements);
							for (const element of elementsArray) {
								// Try to find parent tree-item with data-path
								let currentElement: Element | null = element;
								let filePath: string | null = null;
								
								// Walk up the DOM tree to find a parent with data-path
								for (let i = 0; i < 5 && currentElement; i++) {
									filePath = currentElement.getAttribute('data-path') || 
									           currentElement.getAttribute('data-href') ||
									           null;
									if (filePath) break;
									
									// Also check if it's a tree-item
									if (currentElement.classList.contains('tree-item')) {
										// Try to find data-path in this element or its children
										const pathElement = currentElement.querySelector('[data-path]');
										if (pathElement) {
											filePath = pathElement.getAttribute('data-path');
											if (filePath) break;
										}
									}
									
									currentElement = currentElement.parentElement;
								}
								
								// If still no path, try to get from text content
								if (!filePath) {
									const textContent = element.textContent?.trim();
									if (textContent) {
										// Try to find a link in the element or its children
										const link = element.querySelector('a.internal-link');
										if (link) {
											filePath = link.getAttribute('data-href') || link.getAttribute('href');
										}
									}
								}
								
								if (filePath) {
									// Clean up the path (remove .md if present, Obsidian links don't include it)
									let cleanPath = filePath.replace(/^.*\//, ''); // Get just the filename
									if (!cleanPath.endsWith('.md')) {
										cleanPath = `${cleanPath}.md`;
									}
									
									// Try to find the file
									let tFile = this.app.vault.getAbstractFileByPath(cleanPath);
									
									// If not found, try the full path
									if (!tFile) {
										tFile = this.app.vault.getAbstractFileByPath(filePath);
									}
									
									// If still not found, try to resolve using metadata cache
									if (!tFile) {
										const resolved = this.app.metadataCache.getFirstLinkpathDest(filePath.replace(/\.md$/, ''), '');
										if (resolved instanceof TFile) {
											tFile = resolved;
										}
									}
									
									if (tFile instanceof TFile && !results.find(r => r.path === tFile!.path)) {
										results.push(tFile);
										console.log('[Thoughtlands] Successfully extracted file:', tFile.path, 'from element');
									} else if (!tFile) {
										console.log('[Thoughtlands] Could not resolve file path:', filePath);
									}
								} else {
									console.log('[Thoughtlands] No file path found in element:', element);
								}
							}
						}
					}
				} catch (e) {
					console.log('[Thoughtlands] Error accessing containerEl:', e);
				}
			}
		}

		// Method 2: Try to get from active leaf if it's a search view
		const activeLeaf = this.app.workspace.activeLeaf;
		if (activeLeaf && activeLeaf.view.getViewType() === 'search') {
			console.log('[Thoughtlands] Active leaf is a search view');
			const view = activeLeaf.view as any;
			
			if (view.resultDomLookup && typeof view.resultDomLookup === 'object') {
				for (const filePath of Object.keys(view.resultDomLookup)) {
					const tFile = this.app.vault.getAbstractFileByPath(filePath);
					if (tFile instanceof TFile && !results.find(r => r.path === tFile.path)) {
						results.push(tFile);
					}
				}
			}
			
			if (view.searchResults && Array.isArray(view.searchResults)) {
				for (const result of view.searchResults) {
					if (result && result.file instanceof TFile && !results.find(r => r.path === result.file.path)) {
						results.push(result.file);
					}
				}
			}
		}

		console.log('[Thoughtlands] Final result: Found', results.length, 'search results');
		if (results.length === 0) {
			const allLeafTypes: string[] = [];
			this.app.workspace.iterateAllLeaves((leaf) => {
				allLeafTypes.push(leaf.view.getViewType());
			});
			console.log('[Thoughtlands] No results found. Debug info:', {
				searchLeavesCount: searchLeaves.length,
				activeLeafType: activeLeaf?.view?.getViewType(),
				allLeaves: allLeafTypes
			});
		}
		
		return results;
	}

	private async promptForName(suggestedName: string = ''): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new SimplePromptModal(
				this.app,
				'Region Name',
				'Enter region name',
				(result: string) => {
					resolve(result.trim() || null);
				},
				suggestedName
			);
			modal.open();
		});
	}

	private async promptForColor(): Promise<string | null> {
		return new Promise((resolve) => {
			const defaultColors = this.settings.defaultColors.length > 0 
				? this.settings.defaultColors 
				: ['#E67E22', '#3498DB', '#9B59B6', '#1ABC9C', '#E74C3C', '#F39C12', '#34495E', '#16A085'];
			
			const modal = new ColorPickerModal(
				this.app,
				defaultColors,
				(result: string) => {
					resolve(result);
				}
			);
			modal.open();
		});
	}

	private async promptForConceptsWithScope(): Promise<{ concepts: string[]; scope: ConceptScope } | null> {
		return new Promise((resolve) => {
			const modal = new ConceptInputModal(
				this.app,
				(result) => {
					resolve(result);
				}
			);
			modal.open();
		});
	}

	private getMaxTagsForScope(scope: ConceptScope): number {
		switch (scope) {
			case 'narrow':
				return 10;
			case 'regular':
				return 30;
			case 'broad':
				return 50;
			default:
				return 30;
		}
	}

	private async filterNotesByEmbeddings(concepts: string[], notes: TFile[]): Promise<TFile[]> {
		if (notes.length === 0) return notes;

		try {
			// Generate embeddings for all notes
			console.log('[Thoughtlands] Generating embeddings for', notes.length, 'notes...');
			const noteEmbeddings: { file: TFile; embedding: number[] }[] = [];
			
			for (const note of notes) {
				try {
					const embedding = await this.embeddingService.generateEmbeddingForFile(note);
					noteEmbeddings.push({ file: note, embedding });
				} catch (error) {
					console.warn('[Thoughtlands] Failed to generate embedding for', note.path, error);
					// Include note anyway if embedding fails
					noteEmbeddings.push({ file: note, embedding: [] });
				}
			}

			// Generate embedding for the concepts
			const conceptText = concepts.join(' ');
			const conceptEmbedding = await this.embeddingService.generateEmbedding(conceptText);

			// Calculate similarity and filter
			const relevantNotes: TFile[] = [];
			for (const { file, embedding } of noteEmbeddings) {
				if (embedding.length === 0) {
					// If embedding failed, include the note
					relevantNotes.push(file);
					continue;
				}

				const similarity = this.embeddingService.cosineSimilarity(conceptEmbedding, embedding);
				if (similarity >= this.settings.embeddingSimilarityThreshold) {
					relevantNotes.push(file);
				} else {
					console.log(`[Thoughtlands] Filtering out ${file.path} (similarity: ${similarity.toFixed(3)})`);
				}
			}

			return relevantNotes;
		} catch (error) {
			console.error('[Thoughtlands] Error filtering notes by embeddings:', error);
			return notes; // Return original list on error
		}
	}

	private async findMissedNotesByEmbeddings(concepts: string[], existingNotes: TFile[]): Promise<TFile[]> {
		try {
			// Generate embedding for concepts
			const conceptText = concepts.join(' ');
			const conceptEmbedding = await this.embeddingService.generateEmbedding(conceptText);

			// Get all candidate notes (excluding existing ones)
			const allNotes = this.noteService.getAllNotes();
			const existingPaths = new Set(existingNotes.map(n => n.path));
			const candidateNotes = allNotes.filter(n => !existingPaths.has(n.path));

			console.log('[Thoughtlands] Searching', candidateNotes.length, 'candidate notes for missed relevant ones...');

			// Find similar notes
			const similarNotes = await this.embeddingService.findSimilarNotes(
				conceptEmbedding,
				candidateNotes,
				existingNotes,
				this.settings.maxEmbeddingResults
			);

			return similarNotes.map((r: { file: TFile; similarity: number }) => r.file);
		} catch (error) {
			console.error('[Thoughtlands] Error finding missed notes:', error);
			return [];
		}
	}
}

