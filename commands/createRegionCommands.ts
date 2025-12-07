import { App, TFile, Workspace, Notice, Modal } from 'obsidian';
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
	private plugin: any; // Plugin instance to update status

	constructor(
		app: App,
		regionService: RegionService,
		noteService: NoteService,
		openAIService: OpenAIService,
		localAIService: LocalAIService,
		embeddingService: EmbeddingService,
		settings: ThoughtlandsSettings,
		plugin: any
	) {
		this.app = app;
		this.regionService = regionService;
		this.noteService = noteService;
		this.openAIService = openAIService;
		this.localAIService = localAIService;
		this.embeddingService = embeddingService;
		this.settings = settings;
		this.plugin = plugin;
	}

	updateSettings(newSettings: ThoughtlandsSettings): void {
		this.settings = newSettings;
	}

	async createRegionFromSearch(): Promise<void> {
		// Prompt for search terms
		const searchTerms = await new Promise<string | null>((resolve) => {
			const modal = new SimplePromptModal(
				this.app,
				'Enter Search Terms',
				'Enter search terms to find matching notes (e.g., "John Adams" or "mentorship")',
				(result: string) => {
					resolve(result.trim() || null);
				},
				''
			);
			modal.open();
		});

		if (!searchTerms || searchTerms.trim() === '') {
			return;
		}

		// Search for files matching the terms
		const searchResults = await this.searchFiles(searchTerms);
		const searchQuery = searchTerms;
		
		console.log('[Thoughtlands] ===== CREATE REGION FROM SEARCH =====');
		console.log('[Thoughtlands] createRegionFromSearch: Found', searchResults.length, 'search results');
		console.log('[Thoughtlands] Search result files:', searchResults.map(f => f.path));
		console.log('[Thoughtlands] ======================================');
		
		if (searchResults.length === 0) {
			new Notice('No search results found.');
			return;
		}

		// Filter by all settings (paths and tags)
		const filteredResults = this.regionService.filterNotesByIgnores(
			searchResults,
			this.app.metadataCache,
			this.noteService
		);

		console.log('[Thoughtlands] After filtering:',
			'Original:', searchResults.length,
			'Filtered:', filteredResults.length,
			'Removed:', searchResults.length - filteredResults.length
		);
		
		if (filteredResults.length === 0) {
			new Notice('All search results were filtered out by your folder/tag settings.');
			return;
		}
		
		if (filteredResults.length < searchResults.length) {
			const removedCount = searchResults.length - filteredResults.length;
			console.warn('[Thoughtlands]', removedCount, 'search result(s) were filtered out by settings');
			const removedFiles = searchResults.filter(f => !filteredResults.some(ff => ff.path === f.path));
			console.warn('[Thoughtlands] Removed files:', removedFiles.map(f => f.path));
		}

		// Prompt for name and color
		const name = await this.promptForName();
		if (!name) return;

		const color = await this.promptForColor();
		if (!color) return;

		// Create region
		const notePaths = filteredResults.map(file => file.path);
		console.log('[Thoughtlands] Creating region from search with', notePaths.length, 'notes');
		const region = this.regionService.createRegion(
			name,
			color,
			'search',
			{
				type: 'search',
				query: searchQuery || '',
			},
			notePaths
		);

		console.log('[Thoughtlands] Region created:', {
			id: region.id,
			name: region.name,
			notesCount: region.notes.length,
			notes: region.notes.slice(0, 5) // First 5 for debugging
		});

		// Trigger save and UI update
		if (this.plugin?.onRegionUpdate) {
			await this.plugin.onRegionUpdate();
		}

		new Notice(`Region "${name}" created with ${notePaths.length} notes.`);
	}

	async createRegionFromSearchWithAIAnalysis(): Promise<void> {
		// Check if local model is active
		if (this.settings.aiMode !== 'local') {
			new Notice('AI Analysis is only available when local AI mode is enabled.');
			return;
		}

		// Prompt for search terms
		const searchTerms = await new Promise<string | null>((resolve) => {
			const modal = new SimplePromptModal(
				this.app,
				'Enter Search Terms',
				'Enter search terms to find matching notes (e.g., "John Adams" or "mentorship")',
				(result: string) => {
					resolve(result.trim() || null);
				},
				''
			);
			modal.open();
		});

		if (!searchTerms || searchTerms.trim() === '') {
			return;
		}

		// Search for files matching the terms
		const searchResults = await this.searchFiles(searchTerms);
		const searchQuery = searchTerms;
		
		if (searchResults.length === 0) {
			new Notice('No search results found. Please perform a search first.');
			return;
		}

		// Filter by all settings (paths and tags)
		const filteredResults = this.regionService.filterNotesByIgnores(
			searchResults,
			this.app.metadataCache,
			this.noteService
		);

		if (filteredResults.length === 0) {
			new Notice('All search results were filtered out by your folder/tag settings.');
			return;
		}

		// Track processing info
		const processingInfo: any = {
			searchResultsCount: filteredResults.length,
		};

		// Update status
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Analyzing search results with AI...',
				details: `Computing embeddings for ${filteredResults.length} search results`
			});
		}

		new Notice('Analyzing search results with AI embeddings...');

		// Get embeddings for search results
		const searchResultEmbeddings: number[][] = [];
		const filesWithEmbeddings: TFile[] = [];
		
		const storageService = this.embeddingService.getStorageService();
		for (const file of filteredResults) {
			const embedding = await storageService.getEmbedding(file);
			if (embedding) {
				searchResultEmbeddings.push(embedding);
				filesWithEmbeddings.push(file);
			}
		}

		processingInfo.searchResultsWithEmbeddings = filesWithEmbeddings.length;

		if (searchResultEmbeddings.length === 0) {
			new Notice('No embeddings found for search results. Please generate embeddings first.');
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			return;
		}

		// Calculate centroid from search result embeddings
		const centroid = this.embeddingService.calculateCentroid(searchResultEmbeddings);
		
		if (centroid.length === 0) {
			new Notice('Failed to calculate centroid from search results.');
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			return;
		}

		// Update status
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Finding similar notes...',
				details: `Searching for notes similar to ${filesWithEmbeddings.length} search results`
			});
		}

		// Find similar notes using embedding analysis
		// Get all markdown files as candidates (excluding search results)
		const allMarkdownFiles = this.app.vault.getMarkdownFiles();
		const candidateFiles = allMarkdownFiles.filter(f => 
			!filteredResults.some(sr => sr.path === f.path)
		);

		// Filter candidates by settings
		const filteredCandidates = this.regionService.filterNotesByIgnores(
			candidateFiles,
			this.app.metadataCache,
			this.noteService
		);

		const similarNotes = await this.embeddingService.findSimilarNotes(
			centroid,
			filteredCandidates,
			filteredResults,
			50 // Max 50 additional similar notes
		);

		processingInfo.similarNotesFound = similarNotes.length;
		processingInfo.similarityThreshold = this.settings.embeddingSimilarityThreshold;

		// Combine search results with similar notes
		const allNotes = [...filteredResults];
		for (const { file } of similarNotes) {
			if (!allNotes.some(n => n.path === file.path)) {
				allNotes.push(file);
			}
		}

		if (allNotes.length === 0) {
			new Notice('No notes found after AI analysis.');
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			return;
		}

		// Generate region name using AI (local model)
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Generating region name...',
				details: 'Using AI to suggest a name based on your search query'
			});
		}
		new Notice('Generating region name...');
		console.log('[Thoughtlands] Generating region name for search query:', searchQuery);
		const nameResponse = await this.localAIService.generateRegionNameFromConcept(searchQuery || 'search results');
		
		let suggestedName = '';
		if (nameResponse.success && nameResponse.name) {
			suggestedName = nameResponse.name;
			console.log('[Thoughtlands] AI suggested name:', suggestedName);
		} else {
			console.warn('[Thoughtlands] Failed to generate name, using fallback:', nameResponse.error);
			// Fallback: create a name from search query or generic name
			if (searchQuery && searchQuery.trim()) {
				const words = searchQuery.split(/\s+/).slice(0, 3);
				suggestedName = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
			} else {
				suggestedName = 'Search Results';
			}
		}

		// Update status: finalizing
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Finalizing region...',
				details: 'Please provide a name and color for the region'
			});
		}

		// Prompt for name (pre-filled with AI suggestion) and color
		const name = await this.promptForName(suggestedName);
		if (!name) {
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			return;
		}

		const color = await this.promptForColor();
		if (!color) {
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			return;
		}

		// Create region
		const notePaths = allNotes.map(file => file.path);
		const region = this.regionService.createRegion(
			name,
			color,
			'search',
			{
				type: 'search',
				query: searchQuery || '',
				processingInfo: processingInfo,
			},
			notePaths
		);

		// Trigger save and UI update
		if (this.plugin?.onRegionUpdate) {
			await this.plugin.onRegionUpdate();
		}

		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({ isCreating: false });
		}

		const additionalCount = similarNotes.length;
		new Notice(`Region "${name}" created with ${notePaths.length} notes (${filteredResults.length} from search + ${additionalCount} from AI analysis).`);
	}

	async createRegionFromSemanticSimilarity(): Promise<void> {
		// Check if local model is active
		if (this.settings.aiMode !== 'local') {
			new Notice('Semantic Similarity Analysis is only available when local AI mode is enabled.');
			return;
		}

		// Prompt for concept text using a textarea modal
		const conceptText = await new Promise<string | null>((resolve) => {
			class ConceptTextModal extends Modal {
				onOpen() {
					const { contentEl } = this;
					contentEl.empty();

					contentEl.createEl('h2', { text: 'Enter Concept' });

					// Concepts input
					const conceptsLabel = contentEl.createEl('label', { 
						text: 'Describe your concept (a sentence or two):',
						attr: { style: 'display: block; margin: 10px 0 5px 0;' }
					});

					const textarea = contentEl.createEl('textarea', {
						placeholder: 'e.g., I want to explore how mentorship and belonging create community connections',
						attr: { 
							style: 'width: 100%; margin: 5px 0 15px 0; padding: 5px; min-height: 60px;',
							rows: '3'
						},
					});

					textarea.focus();

					const buttonContainer = contentEl.createDiv({ attr: { style: 'text-align: right; margin-top: 10px;' } });
					
					const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
					cancelButton.addEventListener('click', () => {
						this.close();
						resolve(null);
					});

					const submitButton = buttonContainer.createEl('button', { text: 'OK', attr: { style: 'margin-left: 10px;' } });
					submitButton.addEventListener('click', () => {
						resolve(textarea.value.trim() || null);
						this.close();
					});

					textarea.addEventListener('keydown', (e) => {
						if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
							resolve(textarea.value.trim() || null);
							this.close();
						}
						if (e.key === 'Escape') {
							this.close();
							resolve(null);
						}
					});
				}

				onClose() {
					const { contentEl } = this;
					contentEl.empty();
				}
			}

			const modal = new ConceptTextModal(this.app);
			modal.open();
		});

		if (!conceptText || conceptText.trim() === '') {
			return;
		}

		// Update status
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Generating embedding for concept...',
				details: `Analyzing: ${conceptText}`
			});
		}

		new Notice('Generating embedding for concept...');

		// Generate embedding for the concept
		let conceptEmbedding: number[];
		try {
			conceptEmbedding = await this.embeddingService.generateEmbedding(conceptText);
		} catch (error) {
			console.error('[Thoughtlands] Failed to generate concept embedding:', error);
			new Notice('Failed to generate embedding for concept. Please try again.');
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			return;
		}

		// Update status
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Finding similar notes...',
				details: 'Searching vault for semantically similar notes'
			});
		}

		// Get all markdown files as candidates
		const allMarkdownFiles = this.app.vault.getMarkdownFiles();

		// Filter candidates by settings
		const filteredCandidates = this.regionService.filterNotesByIgnores(
			allMarkdownFiles,
			this.app.metadataCache,
			this.noteService
		);

		// Find similar notes using embedding analysis
		const similarNotes = await this.embeddingService.findSimilarNotes(
			conceptEmbedding,
			filteredCandidates,
			[], // No exclusions
			100 // Max 100 similar notes
		);

		if (similarNotes.length === 0) {
			new Notice('No semantically similar notes found.');
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			return;
		}

		// Track processing info
		const processingInfo: any = {
			conceptText: conceptText,
			similarNotesFound: similarNotes.length,
			similarityThreshold: this.settings.embeddingSimilarityThreshold,
		};

		// Get the files from similar notes
		const matchingFiles = similarNotes.map(({ file }) => file);

		// Generate region name using AI
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Generating region name...',
				details: 'Using AI to suggest a name based on your concept'
			});
		}
		new Notice('Generating region name...');
		console.log('[Thoughtlands] Generating region name for concept:', conceptText);
		const nameResponse = await this.localAIService.generateRegionNameFromConcept(conceptText);
		
		let suggestedName = '';
		if (nameResponse.success && nameResponse.name) {
			suggestedName = nameResponse.name;
			console.log('[Thoughtlands] AI suggested name:', suggestedName);
		} else {
			console.warn('[Thoughtlands] Failed to generate name, using fallback:', nameResponse.error);
			// Fallback: create a name from first few words of concept
			const words = conceptText.split(/\s+/).slice(0, 3);
			suggestedName = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
		}

		// Update status: finalizing
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Finalizing region...',
				details: 'Please provide a name and color for the region'
			});
		}

		// Prompt for name (pre-filled with AI suggestion) and color
		const name = await this.promptForName(suggestedName);
		if (!name) {
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			return;
		}

		const color = await this.promptForColor();
		if (!color) {
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			return;
		}

		// Create region
		const notePaths = matchingFiles.map(file => file.path);
		const region = this.regionService.createRegion(
			name,
			color,
			'concept',
			{
				type: 'concept',
				concepts: [conceptText],
				aiMode: 'local',
				processingInfo: processingInfo,
			},
			notePaths
		);

		// Trigger save and UI update
		if (this.plugin?.onRegionUpdate) {
			await this.plugin.onRegionUpdate();
		}

		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({ isCreating: false });
		}

		new Notice(`Region "${name}" created with ${notePaths.length} semantically similar notes.`);
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

		// Update status: starting
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Querying AI for related tags...',
				details: `Analyzing concept: ${concepts.length === 1 ? concepts[0] : concepts.join(', ')}`
			});
		}

		// Step 1: Get initial tag suggestions from AI (OpenAI or Local)
		const useLocal = this.settings.aiMode === 'local';
		new Notice(useLocal ? 'Querying local AI for related tags...' : 'Querying AI for related tags...');
		const conceptDescription = concepts.length === 1 ? concepts[0] : concepts.join(', ');
		console.log('[Thoughtlands] Querying', useLocal ? 'Local AI' : 'OpenAI', 'for tags related to concept:', conceptDescription, 'with scope:', scope);

		// Get all available tags from the vault to provide to AI
		const availableTags = this.noteService.getAllTags();
		console.log('[Thoughtlands] Found', availableTags.length, 'tags in vault');
		
		// Create a case-insensitive set for quick lookup
		const availableTagsSet = new Set(availableTags.map(t => t.toLowerCase()));

		const initialAiResponse = useLocal
			? await this.localAIService.getRelatedTags(concepts, scope, undefined, availableTags)
			: await this.openAIService.getRelatedTags(concepts, scope, undefined, availableTags);
		
		console.log('[Thoughtlands] Initial AI response:', {
			success: initialAiResponse.success,
			tagsCount: initialAiResponse.tags?.length || 0,
			tags: initialAiResponse.tags,
			error: initialAiResponse.error
		});

		if (!initialAiResponse.success || !initialAiResponse.tags || initialAiResponse.tags.length === 0) {
			console.error('[Thoughtlands] Initial AI query failed:', initialAiResponse.error);
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			new Notice(initialAiResponse.error || 'Failed to get related tags from AI.');
			return;
		}

		// Filter AI response to only include tags that actually exist in the vault
		// Also normalize tags (remove # prefix, handle case)
		const validInitialTags = initialAiResponse.tags
			.map(tag => tag.trim().replace(/^#/, '')) // Remove # prefix and whitespace
			.filter(tag => {
				if (!tag) return false; // Skip empty tags
				const tagLower = tag.toLowerCase();
				const isValid = availableTagsSet.has(tagLower);
				if (!isValid) {
					console.warn(`[Thoughtlands] AI suggested invalid tag: "${tag}" (not in vault)`);
				}
				return isValid;
			})
			// Map back to original case from availableTags if possible
			.map(tagLower => {
				const originalTag = availableTags.find(t => t.toLowerCase() === tagLower.toLowerCase());
				return originalTag || tagLower;
			});
		
		if (validInitialTags.length === 0) {
			console.error('[Thoughtlands] AI returned no valid tags from vault');
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			new Notice('AI did not return any valid tags from your vault. Please try different concepts.');
			return;
		}
		
		if (validInitialTags.length < initialAiResponse.tags.length) {
			console.warn(`[Thoughtlands] Filtered out ${initialAiResponse.tags.length - validInitialTags.length} invalid tags from AI response`);
		}

		// Update status: gathering samples
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Gathering context from notes...',
				details: `Found ${initialAiResponse.tags.length} initial tags, reviewing note excerpts`
			});
		}

		// Step 2: Gather samples from notes with the suggested tags (using validated tags)
		new Notice('Gathering context from notes...');
		const tagSamples = await this.noteService.getTagSamples(validInitialTags, 3);
		console.log('[Thoughtlands] Collected tag samples for', tagSamples.size, 'tags');

		// Update status: refining tags
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Refining tag selection...',
				details: 'AI is reviewing note excerpts to select most relevant tags'
			});
		}

		// Step 3: Filter tags by relevance using the samples
		new Notice('Refining tag selection...');
		const maxTags = this.getMaxTagsForScope(scope);
		const aiResponse = useLocal
			? await this.localAIService.filterTagsByRelevance(concepts, validInitialTags, tagSamples, maxTags, availableTags)
			: await this.openAIService.filterTagsByRelevance(concepts, validInitialTags, tagSamples, maxTags, availableTags);
		
		console.log('[Thoughtlands] AI refinement response:', {
			success: aiResponse.success,
			tagsCount: aiResponse.tags?.length || 0,
			tags: aiResponse.tags,
			error: aiResponse.error
		});

		if (!aiResponse.success || !aiResponse.tags || aiResponse.tags.length === 0) {
			console.error('[Thoughtlands] AI refinement query failed:', aiResponse.error);
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			new Notice(aiResponse.error || 'Failed to refine tags from AI.');
			return;
		}

		// Filter refined tags to only include tags that actually exist in the vault
		// Also normalize tags (remove # prefix, handle case)
		const validRefinedTags = aiResponse.tags
			.map(tag => tag.trim().replace(/^#/, '')) // Remove # prefix and whitespace
			.filter(tag => {
				if (!tag) return false; // Skip empty tags
				const tagLower = tag.toLowerCase();
				const isValid = availableTagsSet.has(tagLower);
				if (!isValid) {
					console.warn(`[Thoughtlands] AI refined to invalid tag: "${tag}" (not in vault)`);
				}
				return isValid;
			})
			// Map back to original case from availableTags if possible
			.map(tagLower => {
				const originalTag = availableTags.find(t => t.toLowerCase() === tagLower.toLowerCase());
				return originalTag || tagLower;
			});
		
		if (validRefinedTags.length === 0) {
			console.error('[Thoughtlands] AI returned no valid refined tags from vault');
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			new Notice('AI did not return any valid tags from your vault. Please try different concepts.');
			return;
		}
		
		if (validRefinedTags.length < aiResponse.tags.length) {
			console.warn(`[Thoughtlands] Filtered out ${aiResponse.tags.length - validRefinedTags.length} invalid tags from AI refinement`);
		}

		// Filter tags by ignores (using validated tags)
		const filteredTags = this.regionService.filterTagsByIgnores(validRefinedTags);
		console.log('[Thoughtlands] Tags after filtering ignores:', {
			originalCount: validRefinedTags.length,
			filteredCount: filteredTags.length,
			originalTags: validRefinedTags,
			filteredTags: filteredTags,
			ignoredTags: this.settings.ignoredTags
		});

		if (filteredTags.length === 0) {
			console.warn('[Thoughtlands] All suggested tags were filtered out by ignore list');
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			new Notice('All suggested tags were filtered out.');
			return;
		}

		// Update status: searching notes
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Searching for notes...',
				details: `Using ${filteredTags.length} refined tags to find matching notes`
			});
		}

		// Get all notes with those tags
		console.log('[Thoughtlands] Searching for notes with tags:', filteredTags);
		const notes = this.noteService.getNotesByTags(filteredTags);
		console.log('[Thoughtlands] Notes found before path filtering:', notes.length, notes.map(n => n.path));

		let finalNotes = this.regionService.filterNotesByIgnores(
			notes,
			this.app.metadataCache,
			this.noteService
		);
		console.log('[Thoughtlands] Notes found after filtering:', {
			beforeFilter: notes.length,
			afterFilter: finalNotes.length,
			finalNotes: finalNotes.map(n => n.path),
			ignoredPaths: this.settings.ignoredPaths,
			includedPaths: this.settings.includedPaths,
			ignoredTags: this.settings.ignoredTags,
			includedTags: this.settings.includedTags
		});

		// Apply embedding-based filtering if using local model and embeddings are available
		let embeddingFiltered = false;
		let embeddingRemovedCount = 0;
		let embeddingAddedCount = 0;
		const notesBeforeEmbedding = finalNotes.length;
		if (useLocal && this.embeddingService.isEmbeddingProcessComplete()) {
			try {
				// Update status: embedding filtering
				if (this.plugin?.updateRegionCreationStatus) {
					this.plugin.updateRegionCreationStatus({
						isCreating: true,
						step: 'Filtering by semantic similarity...',
						details: `Analyzing ${finalNotes.length} notes for semantic relevance`
					});
				}
				new Notice('Filtering notes by semantic similarity...');
				console.log('[Thoughtlands] Applying embedding-based filtering to', finalNotes.length, 'notes');
				
				const beforeEmbeddingFilter = finalNotes.length;
				finalNotes = await this.filterNotesByEmbeddings(concepts, finalNotes);
				embeddingFiltered = true;
				embeddingRemovedCount = beforeEmbeddingFilter - finalNotes.length;
				
				console.log('[Thoughtlands] Notes after embedding filtering:', {
					beforeFilter: beforeEmbeddingFilter,
					afterFilter: finalNotes.length,
					removed: embeddingRemovedCount
				});

				// Optionally find additional notes that might have been missed
				if (finalNotes.length > 0 && this.settings.maxEmbeddingResults > 0) {
					// Update status: finding additional notes
					if (this.plugin?.updateRegionCreationStatus) {
						this.plugin.updateRegionCreationStatus({
							isCreating: true,
							step: 'Searching for additional relevant notes...',
							details: `Found ${finalNotes.length} notes, searching for more via semantic similarity`
						});
					}
					new Notice('Searching for additional relevant notes...');
					console.log('[Thoughtlands] Searching for missed notes using embeddings...');
					
					try {
						const missedNotes = await this.findMissedNotesByEmbeddings(concepts, finalNotes);
						
						if (missedNotes.length > 0) {
							console.log('[Thoughtlands] Found', missedNotes.length, 'additional relevant notes via embeddings');
							// Filter missed notes by all settings (paths and tags)
							const filteredMissed = this.regionService.filterNotesByIgnores(
								missedNotes,
								this.app.metadataCache,
								this.noteService
							);
							// Add to final notes (avoid duplicates)
							const existingPaths = new Set(finalNotes.map(n => n.path));
							const newNotes = filteredMissed.filter(n => !existingPaths.has(n.path));
							finalNotes = [...finalNotes, ...newNotes];
							embeddingAddedCount = newNotes.length;
							console.log('[Thoughtlands] Added', newNotes.length, 'new notes from embedding search');
						}
					} catch (embeddingSearchError) {
						// If embedding search fails, continue with what we have
						console.warn('[Thoughtlands] Error during embedding search for missed notes:', embeddingSearchError);
						// Don't show error to user, just continue silently
					}
				}
			} catch (error) {
				console.error('[Thoughtlands] Error during embedding filtering:', error);
				// Continue with original notes if embedding filtering fails
				if (this.plugin?.updateRegionCreationStatus) {
					this.plugin.updateRegionCreationStatus({
						isCreating: true,
						step: 'Continuing after embedding error...',
						details: 'Embedding filtering failed, using all matching notes'
					});
				}
				new Notice('Embedding filtering failed, using all matching notes.');
			}
		} else if (useLocal && !this.embeddingService.isEmbeddingProcessComplete()) {
			console.log('[Thoughtlands] Embeddings not complete, skipping embedding-based filtering');
		}

		if (finalNotes.length === 0) {
			// Provide more accurate error message
			let errorMessage = 'No notes found.';
			if (embeddingFiltered && embeddingRemovedCount > 0) {
				errorMessage = `No notes found after embedding filtering (${embeddingRemovedCount} note${embeddingRemovedCount > 1 ? 's' : ''} were below the similarity threshold of ${this.settings.embeddingSimilarityThreshold}). Try lowering the similarity threshold in settings or using a broader tag scope.`;
			} else {
				errorMessage = 'No notes found with the suggested tags.';
			}
			
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			
			console.warn('[Thoughtlands] No notes found. Debug info:', {
				searchTags: filteredTags,
				notesBeforeFilter: notes.length,
				notesAfterFilter: finalNotes.length,
				embeddingFiltered: embeddingFiltered,
				embeddingRemovedCount: embeddingRemovedCount
			});
			new Notice(errorMessage);
			return;
		}

		// Update status: generating name
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Generating region name...',
				details: `Found ${finalNotes.length} notes, creating region name`
			});
		}

		// Generate region name using AI
		new Notice('Generating region name...');
		console.log('[Thoughtlands] Generating region name for concept:', conceptDescription);
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

		// Update status: finalizing
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Finalizing region...',
				details: 'Please provide a name and color for the region'
			});
		}

		// Prompt for name (pre-filled with AI suggestion) and color
		const name = await this.promptForName(suggestedName);
		if (!name) {
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			return;
		}

		const color = await this.promptForColor();
		if (!color) {
			if (this.plugin?.updateRegionCreationStatus) {
				this.plugin.updateRegionCreationStatus({ isCreating: false });
			}
			return;
		}

		// Update status: creating
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({
				isCreating: true,
				step: 'Creating region...',
				details: `Saving region "${name}" with ${finalNotes.length} notes`
			});
		}

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
				aiMode: useLocal ? 'local' : 'openai', // Store which AI was used
				processingInfo: {
					initialTags: validInitialTags || [],
					refinedTags: validRefinedTags || [],
					initialTagsCount: initialAiResponse.tags?.length || 0, // Raw AI response count (before validation)
					refinedTagsCount: aiResponse.tags?.length || 0, // Raw AI response count (before validation)
					finalTagsCount: filteredTags.length || 0, // Final tags after ignore filtering (what's displayed)
					notesBeforeEmbedding: notesBeforeEmbedding,
					embeddingRemovedCount: embeddingRemovedCount,
					embeddingAddedCount: embeddingAddedCount,
					embeddingFiltered: embeddingFiltered,
					similarityThreshold: this.settings.embeddingSimilarityThreshold
				}
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
		
		// Clear status
		if (this.plugin?.updateRegionCreationStatus) {
			this.plugin.updateRegionCreationStatus({ isCreating: false });
		}
		
		new Notice(`Region "${name}" created with ${notePaths.length} notes from AI-suggested tags.`);
	}

	private getActiveSearchQuery(): string | null {
		// Try multiple ways to find the search view
		let searchView: any = null;
		
		// Method 1: Get all search leaves
		const searchLeaves = this.app.workspace.getLeavesOfType('search');
		if (searchLeaves.length > 0) {
			searchView = searchLeaves[0].view as any;
		}
		
		// Method 2: Check active leaf if it's a search view
		if (!searchView) {
			const activeLeaf = this.app.workspace.activeLeaf;
			if (activeLeaf && activeLeaf.view.getViewType() === 'search') {
				searchView = activeLeaf.view as any;
			}
		}
		
		// Method 3: Iterate through all leaves to find a search view
		if (!searchView) {
			this.app.workspace.iterateAllLeaves((leaf) => {
				if (leaf.view.getViewType() === 'search') {
					searchView = leaf.view as any;
					return false; // Stop iteration
				}
			});
		}
		
		if (!searchView || !searchView.searchQuery) {
			return null;
		}
		
		const queryString = searchView.searchQuery.query;
		if (!queryString || typeof queryString !== 'string' || queryString.trim() === '') {
			return null;
		}
		
		return queryString;
	}

	private async searchFiles(searchTerms: string): Promise<TFile[]> {
		// Search files using the provided search terms
		// Applies plugin's own filters (included/excluded paths and tags)
		
		console.log('[Thoughtlands] Searching files with terms:', searchTerms);
		
		// Get all files and search them
		const allFiles = this.app.vault.getMarkdownFiles();
		const matchingFiles: TFile[] = [];
		
		// Split search terms into words (for multi-word queries)
		const searchWords = searchTerms ? searchTerms.toLowerCase().split(/\s+/).filter((w: string) => w.length > 0) : [];
		
		for (const file of allFiles) {
			const fileCache = this.app.metadataCache.getFileCache(file);
			if (!fileCache) continue;
			
			let matches = false;
			
			if (searchWords.length === 0) {
				// No search terms, include all files (they'll be filtered by path/tag settings)
				matches = true;
			} else {
				// Check metadata first (faster)
				const searchableMetadata = (
					file.path.toLowerCase() + ' ' +
					file.basename.toLowerCase() + ' ' +
					(fileCache.frontmatter ? JSON.stringify(fileCache.frontmatter).toLowerCase() : '') + ' ' +
					(fileCache.tags ? fileCache.tags.map(t => t.tag.toLowerCase()).join(' ') : '') + ' ' +
					(fileCache.links ? fileCache.links.map(l => (l.original || l.displayText || '').toLowerCase()).join(' ') : '')
				);
				
				// Check if all words are in metadata
				let allWordsInMetadata = true;
				for (const word of searchWords) {
					if (!searchableMetadata.includes(word)) {
						allWordsInMetadata = false;
						break;
					}
				}
				
				if (allWordsInMetadata) {
					matches = true;
				} else {
					// Check file content
					try {
						const content = await this.app.vault.read(file);
						const contentLower = content.toLowerCase();
						
						let allWordsInContent = true;
						for (const word of searchWords) {
							if (!contentLower.includes(word)) {
								allWordsInContent = false;
								break;
							}
						}
						
						if (allWordsInContent) {
							matches = true;
						}
					} catch (e) {
						// If we can't read the file, skip it
						continue;
					}
				}
			}
			
			if (matches) {
				matchingFiles.push(file);
			}
		}
		
		console.log('[Thoughtlands] Found', matchingFiles.length, 'files matching search terms');
		
		// Apply plugin's own filters (included/excluded paths and tags)
		const filteredFiles = this.regionService.filterNotesByIgnores(
			matchingFiles,
			this.app.metadataCache,
			this.noteService
		);
		
		console.log('[Thoughtlands] After applying plugin filters:', filteredFiles.length, 'files');
		
		return filteredFiles;
	}
	
	private async manualSearch(queryString: string): Promise<TFile[]> {
		// Parse the query string for path filters and text search
		const pathMatch = queryString.match(/path:([^\s]+)/);
		const pathFilter = pathMatch ? pathMatch[1].trim() : null;
		
		// Extract text search terms (everything except path: filters)
		const textQuery = queryString.replace(/path:[^\s]+/g, '').trim();
		
		const allMarkdownFiles = this.app.vault.getMarkdownFiles();
		const matchingFiles: TFile[] = [];
		
		for (const file of allMarkdownFiles) {
			// Check path filter first
			if (pathFilter) {
				if (!file.path.includes(pathFilter)) {
					continue;
				}
			}
			
			// If we only have a path filter, include the file
			if (!textQuery) {
				matchingFiles.push(file);
				continue;
			}
			
			// Check text search in various places
			const fileCache = this.app.metadataCache.getFileCache(file);
			let matches = false;
			
			// Check in file path/name
			if (file.path.toLowerCase().includes(textQuery.toLowerCase()) || 
			    file.basename.toLowerCase().includes(textQuery.toLowerCase())) {
				matches = true;
			}
			
			// Check in frontmatter
			if (fileCache?.frontmatter) {
				const frontmatterStr = JSON.stringify(fileCache.frontmatter).toLowerCase();
				if (frontmatterStr.includes(textQuery.toLowerCase())) {
					matches = true;
				}
			}
			
			// Check in tags
			if (fileCache?.tags) {
				for (const tag of fileCache.tags) {
					if (tag.tag.toLowerCase().includes(textQuery.toLowerCase())) {
						matches = true;
						break;
					}
				}
			}
			
			// Check in links
			if (fileCache?.links) {
				for (const link of fileCache.links) {
					if (link.original?.toLowerCase().includes(textQuery.toLowerCase()) ||
					    link.displayText?.toLowerCase().includes(textQuery.toLowerCase())) {
						matches = true;
						break;
					}
				}
			}
			
			// For multi-word queries, check if ALL words appear somewhere (not necessarily together)
			// This handles cases like "John Adams" where both words should be present
			if (!matches && textQuery.includes(' ') && fileCache) {
				const words = textQuery.toLowerCase().split(/\s+/).filter(w => w.length > 0);
				let allWordsFound = true;
				const searchableText = (
					file.path.toLowerCase() + ' ' +
					file.basename.toLowerCase() + ' ' +
					(fileCache?.frontmatter ? JSON.stringify(fileCache.frontmatter).toLowerCase() : '') + ' ' +
					(fileCache?.tags ? fileCache.tags.map(t => t.tag.toLowerCase()).join(' ') : '') + ' ' +
					(fileCache?.links ? fileCache.links.map(l => (l.original || l.displayText || '').toLowerCase()).join(' ') : '')
				);
				
				for (const word of words) {
					if (!searchableText.includes(word)) {
						allWordsFound = false;
						break;
					}
				}
				
				if (allWordsFound) {
					matches = true;
				}
			}
			
			// Search file content - this is critical for finding all matches
			if (!matches) {
				try {
					const content = await this.app.vault.read(file);
					const contentLower = content.toLowerCase();
					const queryLower = textQuery.toLowerCase();
					
					// For multi-word queries, check if all words are in content
					if (textQuery.includes(' ')) {
						const words = queryLower.split(/\s+/).filter(w => w.length > 0);
						let allWordsInContent = true;
						for (const word of words) {
							if (!contentLower.includes(word)) {
								allWordsInContent = false;
								break;
							}
						}
						if (allWordsInContent) {
							matches = true;
						}
					} else {
						// Single word - check if it's in content
						if (contentLower.includes(queryLower)) {
							matches = true;
						}
					}
				} catch (e) {
					// If we can't read the file, skip it
					continue;
				}
			}
			
			if (matches) {
				matchingFiles.push(file);
			}
		}
		
		return matchingFiles;
	}
	
	private getActiveSearchResultsFromDOM(): TFile[] {
		const results: TFile[] = [];
		const resultsSet = new Set<string>(); // Track paths to avoid duplicates
		
		// Get all search leaves first (don't rely on active leaf - it might not be the search view)
		const searchLeaves = this.app.workspace.getLeavesOfType('search');
		
		// Also check active leaf if it's a search view
		const activeLeaf = this.app.workspace.activeLeaf;
		if (activeLeaf && activeLeaf.view.getViewType() === 'search') {
			const view = activeLeaf.view as any;
			
			// Try to get all results from the search query's matcher
			// The matcher might have access to all files, not just rendered ones
			if (view.searchQuery && view.searchQuery.matcher && typeof view.searchQuery.matcher === 'object') {
					
					// Try to get all files from the matcher
					const matcher = view.searchQuery.matcher as any;
					
					// Check for matcher methods that might return all results
					if (typeof matcher.getAllFiles === 'function') {
						try {
							const allFiles = matcher.getAllFiles();
							console.log('[Thoughtlands] matcher.getAllFiles() returned:', Array.isArray(allFiles) ? allFiles.length : typeof allFiles);
							if (Array.isArray(allFiles)) {
								for (const file of allFiles) {
									if (file instanceof TFile && !resultsSet.has(file.path)) {
										results.push(file);
										resultsSet.add(file.path);
										console.log('[Thoughtlands]   ✓ Added from matcher.getAllFiles():', file.path);
									}
								}
							}
						} catch (e) {
							console.log('[Thoughtlands] matcher.getAllFiles() failed:', e);
						}
					}
					
					if (typeof matcher.getResults === 'function') {
						try {
							const matcherResults = matcher.getResults();
							console.log('[Thoughtlands] matcher.getResults() returned:', Array.isArray(matcherResults) ? matcherResults.length : typeof matcherResults);
							if (Array.isArray(matcherResults)) {
								for (const result of matcherResults) {
									if (result && result.file instanceof TFile && !resultsSet.has(result.file.path)) {
										results.push(result.file);
										resultsSet.add(result.file.path);
										console.log('[Thoughtlands]   ✓ Added from matcher.getResults():', result.file.path);
									}
								}
							}
						} catch (e) {
							console.log('[Thoughtlands] matcher.getResults() failed:', e);
						}
					}
					
					// Try matcher properties
					if (matcher.files && Array.isArray(matcher.files)) {
						console.log('[Thoughtlands] matcher.files has', matcher.files.length, 'files');
						for (const file of matcher.files) {
							if (file instanceof TFile && !resultsSet.has(file.path)) {
								results.push(file);
								resultsSet.add(file.path);
								console.log('[Thoughtlands]   ✓ Added from matcher.files:', file.path);
							}
						}
					}
					
					// Try other matcher properties
					if (matcher.results && Array.isArray(matcher.results)) {
						console.log('[Thoughtlands] matcher.results has', matcher.results.length, 'results');
						for (const result of matcher.results) {
							if (result && result.file instanceof TFile && !resultsSet.has(result.file.path)) {
								results.push(result.file);
								resultsSet.add(result.file.path);
							}
						}
					}
					
					// Try to call the matcher directly - it might be a function that returns results
					if (typeof matcher === 'function') {
						try {
							const matcherResults = matcher();
							console.log('[Thoughtlands] matcher() (as function) returned:', Array.isArray(matcherResults) ? matcherResults.length : typeof matcherResults);
							if (Array.isArray(matcherResults)) {
								for (const result of matcherResults) {
									if (result && result.file instanceof TFile && !resultsSet.has(result.file.path)) {
										results.push(result.file);
										resultsSet.add(result.file.path);
									}
								}
							}
						} catch (e) {
							console.log('[Thoughtlands] matcher() call failed:', e);
						}
					}
					
				}
				
				
				// Check if there's a way to get all results from the search view's internal state
				// Some Obsidian versions store all results separately from what's rendered
				if (view.cachedResults && Array.isArray(view.cachedResults)) {
					console.log('[Thoughtlands] Found cachedResults with', view.cachedResults.length, 'results');
					for (const result of view.cachedResults) {
						if (result && result.file instanceof TFile) {
							if (!resultsSet.has(result.file.path)) {
								results.push(result.file);
								resultsSet.add(result.file.path);
							}
						}
					}
				}
				
				// Check for a results cache or store
				if (view.resultsCache && typeof view.resultsCache === 'object') {
					const cacheKeys = Object.keys(view.resultsCache);
					console.log('[Thoughtlands] Found resultsCache with', cacheKeys.length, 'entries');
					for (const key of cacheKeys) {
						const cached = view.resultsCache[key];
						if (cached && cached.file instanceof TFile) {
							if (!resultsSet.has(cached.file.path)) {
								results.push(cached.file);
								resultsSet.add(cached.file.path);
								console.log('[Thoughtlands]   ✓ Added from resultsCache:', cached.file.path);
							}
						}
					}
				}
				
				// Try to access the search plugin's results directly
				if ((this.app as any).plugins && (this.app as any).plugins.plugins) {
					const searchPlugin = (this.app as any).plugins.plugins['global-search'] || (this.app as any).plugins.plugins['search'];
					if (searchPlugin) {
						console.log('[Thoughtlands] Found search plugin:', Object.keys(searchPlugin));
						if (searchPlugin.instance && searchPlugin.instance.results) {
							console.log('[Thoughtlands] Search plugin has results:', searchPlugin.instance.results);
						}
					}
				}
				
				// Try resultDomLookup (most common in recent Obsidian versions)
				if (view.resultDomLookup && typeof view.resultDomLookup === 'object') {
					const filePaths = Object.keys(view.resultDomLookup);
					console.log('[Thoughtlands]   File paths in resultDomLookup:', filePaths);
					for (const filePath of filePaths) {
						if (resultsSet.has(filePath)) {
							console.log('[Thoughtlands]   Skipping duplicate:', filePath);
							continue;
						}
						const tFile = this.app.vault.getAbstractFileByPath(filePath);
						if (tFile instanceof TFile) {
							results.push(tFile);
							resultsSet.add(filePath);
							console.log('[Thoughtlands]   ✓ Added:', tFile.path);
						} else {
							console.log('[Thoughtlands]   ✗ Could not resolve file path:', filePath);
						}
					}
				}
				
				// Try allResults if it exists (might contain complete result set)
				if (view.allResults && Array.isArray(view.allResults)) {
					for (const result of view.allResults) {
						if (result && result.file instanceof TFile) {
							if (!resultsSet.has(result.file.path)) {
								results.push(result.file);
								resultsSet.add(result.file.path);
								console.log('[Thoughtlands]   ✓ Added from allResults:', result.file.path);
							}
						}
					}
				}
				
				// Try completeResults if it exists
				if (view.completeResults && Array.isArray(view.completeResults)) {
					for (const result of view.completeResults) {
						if (result && result.file instanceof TFile) {
							if (!resultsSet.has(result.file.path)) {
								results.push(result.file);
								resultsSet.add(result.file.path);
								console.log('[Thoughtlands]   ✓ Added from completeResults:', result.file.path);
							}
						}
					}
				}
				
				// Try fileResults if it exists
				if (view.fileResults && Array.isArray(view.fileResults)) {
					for (const result of view.fileResults) {
						if (result && result.file instanceof TFile) {
							if (!resultsSet.has(result.file.path)) {
								results.push(result.file);
								resultsSet.add(result.file.path);
							}
						}
					}
				}
				
				// Try resultMap if it exists
				if (view.resultMap && typeof view.resultMap === 'object') {
					const resultMapKeys = Object.keys(view.resultMap);
					for (const key of resultMapKeys) {
						const result = view.resultMap[key];
						if (result && result.file instanceof TFile) {
							if (!resultsSet.has(result.file.path)) {
								results.push(result.file);
								resultsSet.add(result.file.path);
								console.log('[Thoughtlands]   ✓ Added from resultMap:', result.file.path);
							}
						}
					}
				}
				
				// Try resultList if it exists
				if (view.resultList && Array.isArray(view.resultList)) {
					for (const result of view.resultList) {
						if (result && result.file instanceof TFile) {
							if (!resultsSet.has(result.file.path)) {
								results.push(result.file);
								resultsSet.add(result.file.path);
							}
						}
					}
				}
				
				// Try searchResults array
				if (view.searchResults && Array.isArray(view.searchResults)) {
					console.log('[Thoughtlands] Found', view.searchResults.length, 'results in active leaf searchResults array');
					for (const result of view.searchResults) {
						if (result && result.file instanceof TFile) {
							if (!resultsSet.has(result.file.path)) {
								results.push(result.file);
								resultsSet.add(result.file.path);
							}
						} else if (result && result.file && typeof result.file === 'string') {
							// Sometimes file is a path string
							const tFile = this.app.vault.getAbstractFileByPath(result.file);
							if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
								results.push(tFile);
								resultsSet.add(tFile.path);
							}
						}
					}
				}
				
				// Try result property (might be an array or object)
				if (view.result) {
					console.log('[Thoughtlands] Found result property:', typeof view.result, Array.isArray(view.result) ? view.result.length : 'not array');
					if (Array.isArray(view.result)) {
						for (const result of view.result) {
							if (result && result.file instanceof TFile) {
								if (!resultsSet.has(result.file.path)) {
									results.push(result.file);
									resultsSet.add(result.file.path);
								}
							}
						}
					} else if (typeof view.result === 'object') {
						// Might be a map/object of results
						for (const key in view.result) {
							const result = view.result[key];
							if (result && result.file instanceof TFile) {
								if (!resultsSet.has(result.file.path)) {
									results.push(result.file);
									resultsSet.add(result.file.path);
								}
							}
						}
					}
				}
				
				// Try results property
				if (view.results && Array.isArray(view.results)) {
					console.log('[Thoughtlands] Found', view.results.length, 'results in results array');
					for (const result of view.results) {
						if (result && result.file instanceof TFile) {
							if (!resultsSet.has(result.file.path)) {
								results.push(result.file);
								resultsSet.add(result.file.path);
							}
						}
					}
				}
				
				// Try getResults() method if available
				if (typeof view.getResults === 'function') {
					try {
						const searchResults = view.getResults();
						console.log('[Thoughtlands] getResults() returned:', typeof searchResults, Array.isArray(searchResults) ? searchResults.length : 'not array');
						if (Array.isArray(searchResults)) {
							for (const result of searchResults) {
								if (result && result.file instanceof TFile) {
									if (!resultsSet.has(result.file.path)) {
										results.push(result.file);
										resultsSet.add(result.file.path);
									}
								} else if (result && typeof result === 'object' && result.path) {
									// Result might have a path property
									const tFile = this.app.vault.getAbstractFileByPath(result.path);
									if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
										results.push(tFile);
										resultsSet.add(tFile.path);
									}
								}
							}
						}
					} catch (e) {
						console.log('[Thoughtlands] getResults() method failed:', e);
					}
				}
				
				// Try DOM-based extraction from active leaf (always run, even if we found some results)
				if (view.containerEl) {
					console.log('[Thoughtlands] Attempting DOM-based extraction from active leaf (found', results.length, 'results so far)...');
					const domResults = this.extractFilesFromDOM(view.containerEl, resultsSet);
					if (domResults.length > 0) {
						results.push(...domResults);
						console.log('[Thoughtlands] DOM extraction from active leaf added', domResults.length, 'additional files');
					}
				}
			}
		
		// Method 2: Process all search view leaves (always run to ensure we get all results)
		
		// Process all search leaves for internal properties
		for (let leafIndex = 0; leafIndex < searchLeaves.length; leafIndex++) {
			const leaf = searchLeaves[leafIndex];
			const view = leaf.view as any;
			if (!view) {
				continue;
			}

			const viewKeys = Object.keys(view).filter(k => !k.startsWith('_'));
			console.log('[Thoughtlands] Leaf', leafIndex + 1, '- ALL view properties:', viewKeys);
			
			// Log detailed inspection of potentially useful properties
			console.log('[Thoughtlands] Leaf', leafIndex + 1, '- Detailed property inspection:');
			for (const key of viewKeys) {
				const value = (view as any)[key];
				if (value && (typeof value === 'object' || Array.isArray(value))) {
					if (Array.isArray(value)) {
						console.log('[Thoughtlands]   ', key, ':', `Array(${value.length})`, value.length > 0 && value.length < 20 ? value : '');
					} else if (typeof value === 'object') {
						const objKeys = Object.keys(value);
						console.log('[Thoughtlands]   ', key, ':', `Object(${objKeys.length} keys)`, objKeys.slice(0, 10));
						// If it looks like a map of file paths, log some sample keys
						if (objKeys.length > 0 && objKeys.length < 50 && objKeys.some(k => k.includes('.md'))) {
							console.log('[Thoughtlands]     Sample keys (looks like file paths):', objKeys.slice(0, 11));
						}
					}
				} else if (typeof value === 'function') {
					console.log('[Thoughtlands]   ', key, ':', 'function');
				} else if (value !== null && value !== undefined) {
					console.log('[Thoughtlands]   ', key, ':', typeof value, String(value).substring(0, 100));
				}
			}

			// Try resultDomLookup first (most common method)
			if (view.resultDomLookup && typeof view.resultDomLookup === 'object') {
				const filePaths = Object.keys(view.resultDomLookup);
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- Found', filePaths.length, 'files in resultDomLookup');
				for (const filePath of filePaths) {
					if (resultsSet.has(filePath)) {
						console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- Skipping duplicate:', filePath);
						continue;
					}
					const tFile = this.app.vault.getAbstractFileByPath(filePath);
					if (tFile instanceof TFile) {
						results.push(tFile);
						resultsSet.add(filePath);
						console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added:', tFile.path);
					} else {
						console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✗ Could not resolve:', filePath);
					}
				}
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- After resultDomLookup: Total =', results.length);
			}

			// Try searchResults array
			if (view.searchResults && Array.isArray(view.searchResults)) {
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- Found', view.searchResults.length, 'results in searchResults array');
				for (const result of view.searchResults) {
					if (result && result.file instanceof TFile) {
						if (!resultsSet.has(result.file.path)) {
							results.push(result.file);
							resultsSet.add(result.file.path);
							console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from searchResults:', result.file.path);
						}
					} else if (result && result.file && typeof result.file === 'string') {
						const tFile = this.app.vault.getAbstractFileByPath(result.file);
						if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
							results.push(tFile);
							resultsSet.add(tFile.path);
							console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from searchResults (string path):', tFile.path);
						}
					}
				}
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- After searchResults: Total =', results.length);
			}

			// Try getResults() method if available
			if (typeof view.getResults === 'function') {
				try {
					const searchResults = view.getResults();
					console.log('[Thoughtlands] Leaf', leafIndex + 1, '- getResults() returned:', typeof searchResults, Array.isArray(searchResults) ? searchResults.length : 'not array');
					if (Array.isArray(searchResults)) {
						for (const result of searchResults) {
							if (result && result.file instanceof TFile) {
								if (!resultsSet.has(result.file.path)) {
									results.push(result.file);
									resultsSet.add(result.file.path);
									console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from getResults():', result.file.path);
								}
							} else if (result && typeof result === 'object' && result.path) {
								const tFile = this.app.vault.getAbstractFileByPath(result.path);
								if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
									results.push(tFile);
									resultsSet.add(tFile.path);
									console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from getResults() (path prop):', tFile.path);
								}
							}
						}
						console.log('[Thoughtlands] Leaf', leafIndex + 1, '- After getResults(): Total =', results.length);
					}
				} catch (e) {
					console.log('[Thoughtlands] Leaf', leafIndex + 1, '- getResults() method failed:', e);
				}
			}
			
			// Try to access result groups or sections if they exist
			// Some Obsidian versions might organize results into groups (e.g., by file, by heading, etc.)
			if (view.resultGroups && Array.isArray(view.resultGroups)) {
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- Found', view.resultGroups.length, 'result groups');
				for (let groupIndex = 0; groupIndex < view.resultGroups.length; groupIndex++) {
					const group = view.resultGroups[groupIndex];
					console.log('[Thoughtlands]   Group', groupIndex + 1, '- Structure:', Object.keys(group || {}));
					if (group) {
						// Try group.results
						if (group.results && Array.isArray(group.results)) {
							console.log('[Thoughtlands]     Group', groupIndex + 1, '- Found', group.results.length, 'results in group.results');
							for (const result of group.results) {
								if (result && result.file instanceof TFile) {
									if (!resultsSet.has(result.file.path)) {
										results.push(result.file);
										resultsSet.add(result.file.path);
										console.log('[Thoughtlands]       ✓ Added from group', groupIndex + 1, ':', result.file.path);
									}
								} else if (result && typeof result === 'object' && result.path) {
									const tFile = this.app.vault.getAbstractFileByPath(result.path);
									if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
										results.push(tFile);
										resultsSet.add(tFile.path);
										console.log('[Thoughtlands]       ✓ Added from group', groupIndex + 1, ' (path prop):', tFile.path);
									}
								}
							}
						}
						// Try group.file if it exists
						if (group.file instanceof TFile) {
							if (!resultsSet.has(group.file.path)) {
								results.push(group.file);
								resultsSet.add(group.file.path);
								console.log('[Thoughtlands]       ✓ Added from group', groupIndex + 1, ' (file prop):', group.file.path);
							}
						}
						// Try group.files if it exists
						if (group.files && Array.isArray(group.files)) {
							console.log('[Thoughtlands]     Group', groupIndex + 1, '- Found', group.files.length, 'files in group.files');
							for (const file of group.files) {
								if (file instanceof TFile && !resultsSet.has(file.path)) {
									results.push(file);
									resultsSet.add(file.path);
									console.log('[Thoughtlands]       ✓ Added from group', groupIndex + 1, ' (files array):', file.path);
								}
							}
						}
					}
				}
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- After resultGroups: Total =', results.length);
			}
			
			// Check if results are organized by file (one result per file, but multiple matches per file)
			// In this case, we need to extract unique files from all result groups
			if (view.resultsByFile && typeof view.resultsByFile === 'object') {
				const fileKeys = Object.keys(view.resultsByFile);
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- Found resultsByFile with', fileKeys.length, 'files');
				for (const filePath of fileKeys) {
					if (!resultsSet.has(filePath)) {
						const tFile = this.app.vault.getAbstractFileByPath(filePath);
						if (tFile instanceof TFile) {
							results.push(tFile);
							resultsSet.add(filePath);
							console.log('[Thoughtlands]   ✓ Added from resultsByFile:', tFile.path);
						}
					}
				}
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- After resultsByFile: Total =', results.length);
			}
			
			// Try to access fileMap if it exists (another way results might be organized)
			if (view.fileMap && typeof view.fileMap === 'object') {
				const fileMapKeys = Object.keys(view.fileMap);
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- Found fileMap with', fileMapKeys.length, 'entries');
				for (const filePath of fileMapKeys) {
					if (resultsSet.has(filePath)) continue;
					const tFile = this.app.vault.getAbstractFileByPath(filePath);
					if (tFile instanceof TFile) {
						results.push(tFile);
						resultsSet.add(filePath);
						console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from fileMap:', tFile.path);
					}
				}
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- After fileMap: Total =', results.length);
			}

			// CRITICAL: Try to get all results from the search query's matcher
			// The matcher might have access to all files, not just rendered ones
			if (view.searchQuery && view.searchQuery.matcher && typeof view.searchQuery.matcher === 'object') {
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- Found searchQuery.matcher, keys:', Object.keys(view.searchQuery.matcher));
				
				// Try to get all files from the matcher
				const matcher = view.searchQuery.matcher as any;
				
				// Check for matcher methods that might return all results
				if (typeof matcher.getAllFiles === 'function') {
					try {
						const allFiles = matcher.getAllFiles();
						console.log('[Thoughtlands] Leaf', leafIndex + 1, '- matcher.getAllFiles() returned:', Array.isArray(allFiles) ? allFiles.length : typeof allFiles);
						if (Array.isArray(allFiles)) {
							for (const file of allFiles) {
								if (file instanceof TFile && !resultsSet.has(file.path)) {
									results.push(file);
									resultsSet.add(file.path);
									console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from matcher.getAllFiles():', file.path);
								}
							}
						}
					} catch (e) {
						console.log('[Thoughtlands] Leaf', leafIndex + 1, '- matcher.getAllFiles() failed:', e);
					}
				}
				
				if (typeof matcher.getResults === 'function') {
					try {
						const matcherResults = matcher.getResults();
						console.log('[Thoughtlands] Leaf', leafIndex + 1, '- matcher.getResults() returned:', Array.isArray(matcherResults) ? matcherResults.length : typeof matcherResults);
						if (Array.isArray(matcherResults)) {
							for (const result of matcherResults) {
								if (result && result.file instanceof TFile && !resultsSet.has(result.file.path)) {
									results.push(result.file);
									resultsSet.add(result.file.path);
									console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from matcher.getResults():', result.file.path);
								} else if (result && typeof result === 'object' && result.path) {
									const tFile = this.app.vault.getAbstractFileByPath(result.path);
									if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
										results.push(tFile);
										resultsSet.add(tFile.path);
										console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from matcher.getResults() (path prop):', tFile.path);
									}
								}
							}
						}
					} catch (e) {
						console.log('[Thoughtlands] Leaf', leafIndex + 1, '- matcher.getResults() failed:', e);
					}
				}
				
				// Try matcher properties
				if (matcher.files && Array.isArray(matcher.files)) {
					console.log('[Thoughtlands] Leaf', leafIndex + 1, '- matcher.files has', matcher.files.length, 'files');
					for (const file of matcher.files) {
						if (file instanceof TFile && !resultsSet.has(file.path)) {
							results.push(file);
							resultsSet.add(file.path);
							console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from matcher.files:', file.path);
						}
					}
					console.log('[Thoughtlands] Leaf', leafIndex + 1, '- After matcher.files: Total =', results.length);
				}
				
				// Try other matcher properties
				if (matcher.results && Array.isArray(matcher.results)) {
					console.log('[Thoughtlands] Leaf', leafIndex + 1, '- matcher.results has', matcher.results.length, 'results');
					for (const result of matcher.results) {
						if (result && result.file instanceof TFile && !resultsSet.has(result.file.path)) {
							results.push(result.file);
							resultsSet.add(result.file.path);
							console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from matcher.results:', result.file.path);
						} else if (result && typeof result === 'object' && result.path) {
							const tFile = this.app.vault.getAbstractFileByPath(result.path);
							if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
								results.push(tFile);
								resultsSet.add(tFile.path);
								console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from matcher.results (path prop):', tFile.path);
							}
						}
					}
					console.log('[Thoughtlands] Leaf', leafIndex + 1, '- After matcher.results: Total =', results.length);
				}
				
				// CRITICAL: matcher.matchers is an array of sub-matchers - iterate through them
				if (matcher.matchers && Array.isArray(matcher.matchers)) {
					console.log('[Thoughtlands] Leaf', leafIndex + 1, '- matcher.matchers has', matcher.matchers.length, 'sub-matchers');
					for (let i = 0; i < matcher.matchers.length; i++) {
						const subMatcher = matcher.matchers[i];
						if (!subMatcher || typeof subMatcher !== 'object') continue;
						
						console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- Processing sub-matcher', i + 1, 'keys:', Object.keys(subMatcher));
						
						// Try getAllFiles() on sub-matcher
						if (typeof subMatcher.getAllFiles === 'function') {
							try {
								const subFiles = subMatcher.getAllFiles();
								console.log('[Thoughtlands]     Sub-matcher', i + 1, '- getAllFiles() returned:', Array.isArray(subFiles) ? subFiles.length : typeof subFiles);
								if (Array.isArray(subFiles)) {
									for (const file of subFiles) {
										if (file instanceof TFile && !resultsSet.has(file.path)) {
											results.push(file);
											resultsSet.add(file.path);
											console.log('[Thoughtlands]       ✓ Added from sub-matcher', i + 1, '.getAllFiles():', file.path);
										}
									}
								}
							} catch (e) {
								console.log('[Thoughtlands]     Sub-matcher', i + 1, '- getAllFiles() failed:', e);
							}
						}
						
						// Try getResults() on sub-matcher
						if (typeof subMatcher.getResults === 'function') {
							try {
								const subResults = subMatcher.getResults();
								console.log('[Thoughtlands]     Sub-matcher', i + 1, '- getResults() returned:', Array.isArray(subResults) ? subResults.length : typeof subResults);
								if (Array.isArray(subResults)) {
									for (const result of subResults) {
										if (result && result.file instanceof TFile && !resultsSet.has(result.file.path)) {
											results.push(result.file);
											resultsSet.add(result.file.path);
											console.log('[Thoughtlands]       ✓ Added from sub-matcher', i + 1, '.getResults():', result.file.path);
										} else if (result && typeof result === 'object' && result.path) {
											const tFile = this.app.vault.getAbstractFileByPath(result.path);
											if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
												results.push(tFile);
												resultsSet.add(tFile.path);
												console.log('[Thoughtlands]       ✓ Added from sub-matcher', i + 1, '.getResults() (path prop):', tFile.path);
											}
										}
									}
								}
							} catch (e) {
								console.log('[Thoughtlands]     Sub-matcher', i + 1, '- getResults() failed:', e);
							}
						}
						
						// Try files property on sub-matcher
						if (subMatcher.files && Array.isArray(subMatcher.files)) {
							console.log('[Thoughtlands]     Sub-matcher', i + 1, '- files has', subMatcher.files.length, 'files');
							for (const file of subMatcher.files) {
								if (file instanceof TFile && !resultsSet.has(file.path)) {
									results.push(file);
									resultsSet.add(file.path);
									console.log('[Thoughtlands]       ✓ Added from sub-matcher', i + 1, '.files:', file.path);
								}
							}
						}
						
						// Try results property on sub-matcher
						if (subMatcher.results && Array.isArray(subMatcher.results)) {
							console.log('[Thoughtlands]     Sub-matcher', i + 1, '- results has', subMatcher.results.length, 'results');
							for (const result of subMatcher.results) {
								if (result && result.file instanceof TFile && !resultsSet.has(result.file.path)) {
									results.push(result.file);
									resultsSet.add(result.file.path);
									console.log('[Thoughtlands]       ✓ Added from sub-matcher', i + 1, '.results:', result.file.path);
								} else if (result && typeof result === 'object' && result.path) {
									const tFile = this.app.vault.getAbstractFileByPath(result.path);
									if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
										results.push(tFile);
										resultsSet.add(tFile.path);
										console.log('[Thoughtlands]       ✓ Added from sub-matcher', i + 1, '.results (path prop):', tFile.path);
									}
								}
							}
						}
						
						// CRITICAL: Check for nested matcher property (sub-matcher 2 has a nested matcher)
						if (subMatcher.matcher && typeof subMatcher.matcher === 'object') {
							console.log('[Thoughtlands]     Sub-matcher', i + 1, '- Found nested matcher, keys:', Object.keys(subMatcher.matcher));
							const nestedMatcher = subMatcher.matcher as any;
							
							// Try getAllFiles() on nested matcher
							if (typeof nestedMatcher.getAllFiles === 'function') {
								try {
									const nestedFiles = nestedMatcher.getAllFiles();
									console.log('[Thoughtlands]       Nested matcher - getAllFiles() returned:', Array.isArray(nestedFiles) ? nestedFiles.length : typeof nestedFiles);
									if (Array.isArray(nestedFiles)) {
										for (const file of nestedFiles) {
											if (file instanceof TFile && !resultsSet.has(file.path)) {
												results.push(file);
												resultsSet.add(file.path);
												console.log('[Thoughtlands]         ✓ Added from nested matcher.getAllFiles():', file.path);
											}
										}
									}
								} catch (e) {
									console.log('[Thoughtlands]       Nested matcher - getAllFiles() failed:', e);
								}
							}
							
							// Try getResults() on nested matcher
							if (typeof nestedMatcher.getResults === 'function') {
								try {
									const nestedResults = nestedMatcher.getResults();
									console.log('[Thoughtlands]       Nested matcher - getResults() returned:', Array.isArray(nestedResults) ? nestedResults.length : typeof nestedResults);
									if (Array.isArray(nestedResults)) {
										for (const result of nestedResults) {
											if (result && result.file instanceof TFile && !resultsSet.has(result.file.path)) {
												results.push(result.file);
												resultsSet.add(result.file.path);
												console.log('[Thoughtlands]         ✓ Added from nested matcher.getResults():', result.file.path);
											} else if (result && typeof result === 'object' && result.path) {
												const tFile = this.app.vault.getAbstractFileByPath(result.path);
												if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
													results.push(tFile);
													resultsSet.add(tFile.path);
													console.log('[Thoughtlands]         ✓ Added from nested matcher.getResults() (path prop):', tFile.path);
												}
											}
										}
									}
								} catch (e) {
									console.log('[Thoughtlands]       Nested matcher - getResults() failed:', e);
								}
							}
							
							// Try files property on nested matcher
							if (nestedMatcher.files && Array.isArray(nestedMatcher.files)) {
								console.log('[Thoughtlands]       Nested matcher - files has', nestedMatcher.files.length, 'files');
								for (const file of nestedMatcher.files) {
									if (file instanceof TFile && !resultsSet.has(file.path)) {
										results.push(file);
										resultsSet.add(file.path);
										console.log('[Thoughtlands]         ✓ Added from nested matcher.files:', file.path);
									}
								}
							}
							
							// Try results property on nested matcher
							if (nestedMatcher.results && Array.isArray(nestedMatcher.results)) {
								console.log('[Thoughtlands]       Nested matcher - results has', nestedMatcher.results.length, 'results');
								for (const result of nestedMatcher.results) {
									if (result && result.file instanceof TFile && !resultsSet.has(result.file.path)) {
										results.push(result.file);
										resultsSet.add(result.file.path);
										console.log('[Thoughtlands]         ✓ Added from nested matcher.results:', result.file.path);
									} else if (result && typeof result === 'object' && result.path) {
										const tFile = this.app.vault.getAbstractFileByPath(result.path);
										if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
											results.push(tFile);
											resultsSet.add(tFile.path);
											console.log('[Thoughtlands]         ✓ Added from nested matcher.results (path prop):', tFile.path);
										}
									}
								}
							}
							
							// Try matchers array on nested matcher (recursive)
							if (nestedMatcher.matchers && Array.isArray(nestedMatcher.matchers)) {
								console.log('[Thoughtlands]       Nested matcher - matchers has', nestedMatcher.matchers.length, 'sub-matchers');
								for (let j = 0; j < nestedMatcher.matchers.length; j++) {
									const nestedSubMatcher = nestedMatcher.matchers[j];
									if (nestedSubMatcher && typeof nestedSubMatcher === 'object') {
										if (nestedSubMatcher.files && Array.isArray(nestedSubMatcher.files)) {
											for (const file of nestedSubMatcher.files) {
												if (file instanceof TFile && !resultsSet.has(file.path)) {
													results.push(file);
													resultsSet.add(file.path);
													console.log('[Thoughtlands]           ✓ Added from nested sub-matcher', j + 1, '.files:', file.path);
												}
											}
										}
									}
								}
							}
						}
						
						// Check matchedTokens - might contain file references
						if (subMatcher.matchedTokens && Array.isArray(subMatcher.matchedTokens)) {
							console.log('[Thoughtlands]     Sub-matcher', i + 1, '- matchedTokens has', subMatcher.matchedTokens.length, 'tokens');
							// Inspect matchedTokens structure deeply
							for (let tokenIndex = 0; tokenIndex < subMatcher.matchedTokens.length && tokenIndex < 10; tokenIndex++) {
								const token = subMatcher.matchedTokens[tokenIndex];
								if (token && typeof token === 'object') {
									const tokenKeys = Object.keys(token);
									console.log('[Thoughtlands]       Token', tokenIndex + 1, '- keys:', tokenKeys);
									
									// Check if token has file property
									if (token.file instanceof TFile && !resultsSet.has(token.file.path)) {
										results.push(token.file);
										resultsSet.add(token.file.path);
										console.log('[Thoughtlands]         ✓ Added from matchedToken', tokenIndex + 1, '.file:', token.file.path);
									}
									
									// Check if token has path property
									if (token.path && typeof token.path === 'string') {
										const tFile = this.app.vault.getAbstractFileByPath(token.path);
										if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
											results.push(tFile);
											resultsSet.add(tFile.path);
											console.log('[Thoughtlands]         ✓ Added from matchedToken', tokenIndex + 1, '.path:', tFile.path);
										}
									}
									
									// Check if token has filePath property
									if (token.filePath && typeof token.filePath === 'string') {
										const tFile = this.app.vault.getAbstractFileByPath(token.filePath);
										if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
											results.push(tFile);
											resultsSet.add(tFile.path);
											console.log('[Thoughtlands]         ✓ Added from matchedToken', tokenIndex + 1, '.filePath:', tFile.path);
										}
									}
								}
							}
						}
						
						// Also check nested matcher's matchedTokens
						if (subMatcher.matcher && subMatcher.matcher.matchedTokens && Array.isArray(subMatcher.matcher.matchedTokens)) {
							console.log('[Thoughtlands]     Sub-matcher', i + 1, '- nested matcher matchedTokens has', subMatcher.matcher.matchedTokens.length, 'tokens');
							for (let tokenIndex = 0; tokenIndex < subMatcher.matcher.matchedTokens.length && tokenIndex < 10; tokenIndex++) {
								const token = subMatcher.matcher.matchedTokens[tokenIndex];
								if (token && typeof token === 'object') {
									const tokenKeys = Object.keys(token);
									console.log('[Thoughtlands]       Nested token', tokenIndex + 1, '- keys:', tokenKeys);
									
									if (token.file instanceof TFile && !resultsSet.has(token.file.path)) {
										results.push(token.file);
										resultsSet.add(token.file.path);
										console.log('[Thoughtlands]         ✓ Added from nested matchedToken', tokenIndex + 1, '.file:', token.file.path);
									}
									
									if (token.path && typeof token.path === 'string') {
										const tFile = this.app.vault.getAbstractFileByPath(token.path);
										if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
											results.push(tFile);
											resultsSet.add(tFile.path);
											console.log('[Thoughtlands]         ✓ Added from nested matchedToken', tokenIndex + 1, '.path:', tFile.path);
										}
									}
								}
							}
						}
					}
					console.log('[Thoughtlands] Leaf', leafIndex + 1, '- After matcher.matchers: Total =', results.length);
				}
				
				// Log all matcher properties for debugging
				const matcherKeys = Object.keys(matcher);
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- matcher has', matcherKeys.length, 'properties:', matcherKeys);
				for (const key of matcherKeys) {
					const value = matcher[key];
					if (Array.isArray(value)) {
						console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- matcher.' + key + ':', `Array(${value.length})`);
						if (value.length > 0 && value.length <= 20) {
							console.log('[Thoughtlands]     Sample items:', value.slice(0, 5));
						}
					} else if (typeof value === 'function') {
						console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- matcher.' + key + ':', 'function');
					} else if (value && typeof value === 'object') {
						console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- matcher.' + key + ':', `Object(${Object.keys(value).length} keys)`);
					}
				}
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- After matcher check: Total =', results.length);
			}
			
			// CRITICAL: Check for any methods on the view that might return all results
			// Look for methods with names like getAllResults, getAllFiles, getCompleteResults, etc.
			const viewMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(view))
				.concat(Object.keys(view))
				.filter(key => typeof (view as any)[key] === 'function' && !key.startsWith('_'));
			
			console.log('[Thoughtlands] Leaf', leafIndex + 1, '- Checking', viewMethods.length, 'methods on search view');
			for (const methodName of viewMethods) {
				if (methodName.toLowerCase().includes('result') || 
				    methodName.toLowerCase().includes('file') ||
				    methodName.toLowerCase().includes('search') ||
				    methodName.toLowerCase().includes('get') ||
				    methodName.toLowerCase().includes('all')) {
					try {
						const method = (view as any)[methodName];
						if (typeof method === 'function' && methodName !== 'getResults') { // We already checked getResults
							console.log('[Thoughtlands]   Trying method:', methodName);
							const methodResult = method.call(view);
							if (Array.isArray(methodResult)) {
								console.log('[Thoughtlands]     Method', methodName, 'returned array with', methodResult.length, 'items');
								for (const item of methodResult) {
									if (item && item.file instanceof TFile && !resultsSet.has(item.file.path)) {
										results.push(item.file);
										resultsSet.add(item.file.path);
										console.log('[Thoughtlands]       ✓ Added from', methodName + '():', item.file.path);
									} else if (item instanceof TFile && !resultsSet.has(item.path)) {
										results.push(item);
										resultsSet.add(item.path);
										console.log('[Thoughtlands]       ✓ Added from', methodName + '() (direct file):', item.path);
									}
								}
							} else if (methodResult && typeof methodResult === 'object') {
								console.log('[Thoughtlands]     Method', methodName, 'returned object with', Object.keys(methodResult).length, 'keys');
							}
						}
					} catch (e) {
						// Method might require parameters or throw - that's okay
					}
				}
			}
			
			// CRITICAL: Check the queue property - it might contain unrendered search results
			// The queue object has keys: ['_loaded', '_events', '_children', 'queue', 'app', 'dom']
			if (view.queue && typeof view.queue === 'object') {
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- Found queue property, inspecting...');
				const queue = view.queue as any;
				const queueKeys = Object.keys(queue);
				console.log('[Thoughtlands]   Queue keys:', queueKeys);
				
				// Check queue.queue (might be an array of queued items)
				if (queue.queue !== undefined) {
					console.log('[Thoughtlands]   Queue.queue exists, type:', typeof queue.queue, Array.isArray(queue.queue) ? `Array(${queue.queue.length})` : 'not array');
					if (Array.isArray(queue.queue)) {
						console.log('[Thoughtlands]   Queue.queue has', queue.queue.length, 'items');
						for (let i = 0; i < queue.queue.length; i++) {
							const item = queue.queue[i];
							if (item && typeof item === 'object') {
								// Check if item has file property
								if (item.file instanceof TFile && !resultsSet.has(item.file.path)) {
									results.push(item.file);
									resultsSet.add(item.file.path);
									console.log('[Thoughtlands]     ✓ Added from queue.queue[' + i + '].file:', item.file.path);
								} else if (item.path && typeof item.path === 'string') {
									const tFile = this.app.vault.getAbstractFileByPath(item.path);
									if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
										results.push(tFile);
										resultsSet.add(tFile.path);
										console.log('[Thoughtlands]     ✓ Added from queue.queue[' + i + '].path:', tFile.path);
									}
								}
							}
						}
					} else if (queue.queue && typeof queue.queue === 'object') {
						// It might be an object/map instead of an array
						const queueQueueKeys = Object.keys(queue.queue);
						console.log('[Thoughtlands]   Queue.queue is an object with', queueQueueKeys.length, 'keys');
						console.log('[Thoughtlands]   Queue.queue sample keys:', queueQueueKeys.slice(0, 10));
						
						// First, check if the keys themselves are file paths
						for (const key of queueQueueKeys) {
							if (!resultsSet.has(key) && typeof key === 'string' && key.includes('.md')) {
								const tFile = this.app.vault.getAbstractFileByPath(key);
								if (tFile instanceof TFile) {
									results.push(tFile);
									resultsSet.add(key);
									console.log('[Thoughtlands]     ✓ Added from queue.queue key (file path):', tFile.path);
								}
							}
						}
						
						// Then check the values
						for (const key of queueQueueKeys) {
							const item = queue.queue[key];
							if (item && typeof item === 'object') {
								if (item.file instanceof TFile && !resultsSet.has(item.file.path)) {
									results.push(item.file);
									resultsSet.add(item.file.path);
									console.log('[Thoughtlands]     ✓ Added from queue.queue[' + key + '].file:', item.file.path);
								} else if (item.path && typeof item.path === 'string') {
									const tFile = this.app.vault.getAbstractFileByPath(item.path);
									if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
										results.push(tFile);
										resultsSet.add(tFile.path);
										console.log('[Thoughtlands]     ✓ Added from queue.queue[' + key + '].path:', tFile.path);
									}
								}
							} else if (typeof item === 'string' && item.includes('.md')) {
								// The value itself might be a file path
								const tFile = this.app.vault.getAbstractFileByPath(item);
								if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
									results.push(tFile);
									resultsSet.add(tFile.path);
									console.log('[Thoughtlands]     ✓ Added from queue.queue[' + key + '] (string path):', tFile.path);
								}
							}
						}
					}
				} else {
					console.log('[Thoughtlands]   Queue.queue does not exist');
				}
				
				// Check queue._children (might contain child items)
				if (queue._children && Array.isArray(queue._children)) {
					console.log('[Thoughtlands]   Queue._children has', queue._children.length, 'items');
					for (let i = 0; i < queue._children.length; i++) {
						const child = queue._children[i];
						if (child && typeof child === 'object') {
							if (child.file instanceof TFile && !resultsSet.has(child.file.path)) {
								results.push(child.file);
								resultsSet.add(child.file.path);
								console.log('[Thoughtlands]     ✓ Added from queue._children[' + i + '].file:', child.file.path);
							} else if (child.path && typeof child.path === 'string') {
								const tFile = this.app.vault.getAbstractFileByPath(child.path);
								if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
									results.push(tFile);
									resultsSet.add(tFile.path);
									console.log('[Thoughtlands]     ✓ Added from queue._children[' + i + '].path:', tFile.path);
								}
							}
						}
					}
				}
				
				// Check queue.dom (might contain DOM-related results)
				if (queue.dom && typeof queue.dom === 'object') {
					const queueDomKeys = Object.keys(queue.dom);
					console.log('[Thoughtlands]   Queue.dom has', queueDomKeys.length, 'keys:', queueDomKeys);
					
					// Check if queue.dom has resultDomLookup or similar
					if (queue.dom.resultDomLookup && typeof queue.dom.resultDomLookup === 'object') {
						const queueLookupKeys = Object.keys(queue.dom.resultDomLookup);
						console.log('[Thoughtlands]     Queue.dom.resultDomLookup has', queueLookupKeys.length, 'entries');
						for (const key of queueLookupKeys) {
							if (!resultsSet.has(key)) {
								const tFile = this.app.vault.getAbstractFileByPath(key);
								if (tFile instanceof TFile) {
									results.push(tFile);
									resultsSet.add(key);
									console.log('[Thoughtlands]       ✓ Added from queue.dom.resultDomLookup:', tFile.path);
								}
							}
						}
					}
				}
				
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- After queue check: Total =', results.length);
			}

			// CRITICAL: view.dom is an object, not an Element! It contains resultDomLookup
			// Try accessing view.dom.resultDomLookup which should contain file paths
			if (view.dom && view.dom.resultDomLookup && typeof view.dom.resultDomLookup === 'object') {
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- Found resultDomLookup in view.dom');
				const resultDomLookup = view.dom.resultDomLookup;
				const lookupKeys = Object.keys(resultDomLookup);
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- resultDomLookup has', lookupKeys.length, 'entries');
				
				// resultDomLookup is typically a map of file paths to DOM elements or result objects
				for (const key of lookupKeys) {
					if (!resultsSet.has(key)) {
						// The key might be a file path
						const tFile = this.app.vault.getAbstractFileByPath(key);
						if (tFile instanceof TFile) {
							results.push(tFile);
							resultsSet.add(key);
							console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from resultDomLookup:', tFile.path);
						} else {
							// The value might contain the file path
							const value = resultDomLookup[key];
							if (value && typeof value === 'object') {
								// Check if value has a file property
								if (value.file instanceof TFile) {
									if (!resultsSet.has(value.file.path)) {
										results.push(value.file);
										resultsSet.add(value.file.path);
										console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from resultDomLookup value.file:', value.file.path);
									}
								} else if (value.path) {
									const tFile2 = this.app.vault.getAbstractFileByPath(value.path);
									if (tFile2 instanceof TFile && !resultsSet.has(tFile2.path)) {
										results.push(tFile2);
										resultsSet.add(tFile2.path);
										console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from resultDomLookup value.path:', tFile2.path);
									}
								}
							}
						}
					}
				}
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- After resultDomLookup: Total =', results.length);
			}
			
			// CRITICAL: view.dom is an object, not an Element! It contains resultDomLookup and vChildren
			// Try accessing view.dom.resultDomLookup which should contain file paths
			if (view.dom && view.dom.resultDomLookup && typeof view.dom.resultDomLookup === 'object') {
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- Found resultDomLookup in view.dom');
				const resultDomLookup = view.dom.resultDomLookup;
				const lookupKeys = Object.keys(resultDomLookup);
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- resultDomLookup has', lookupKeys.length, 'entries');
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- resultDomLookup sample keys:', lookupKeys.slice(0, 11));
				
				// Also check vChildren - this might contain virtualized children with file info
				if (view.dom && view.dom.vChildren) {
					console.log('[Thoughtlands] Leaf', leafIndex + 1, '- Found vChildren:', typeof view.dom.vChildren, Array.isArray(view.dom.vChildren) ? `Array(${view.dom.vChildren.length})` : 'not array');
					if (Array.isArray(view.dom.vChildren)) {
						console.log('[Thoughtlands] Leaf', leafIndex + 1, '- vChildren array has', view.dom.vChildren.length, 'items');
						for (let i = 0; i < view.dom.vChildren.length; i++) {
							const vChild = view.dom.vChildren[i];
							if (vChild && typeof vChild === 'object') {
								const vChildKeys = Object.keys(vChild);
								console.log('[Thoughtlands]   vChild', i, '- keys:', vChildKeys.slice(0, 10));
								// Check for file path in various properties
								if (vChild.file instanceof TFile && !resultsSet.has(vChild.file.path)) {
									results.push(vChild.file);
									resultsSet.add(vChild.file.path);
									console.log('[Thoughtlands]     ✓ Added from vChild.file:', vChild.file.path);
								} else if (vChild.path) {
									const tFile = this.app.vault.getAbstractFileByPath(vChild.path);
									if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
										results.push(tFile);
										resultsSet.add(tFile.path);
										console.log('[Thoughtlands]     ✓ Added from vChild.path:', tFile.path);
									}
								} else if (vChild.filePath) {
									const tFile = this.app.vault.getAbstractFileByPath(vChild.filePath);
									if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
										results.push(tFile);
										resultsSet.add(tFile.path);
										console.log('[Thoughtlands]     ✓ Added from vChild.filePath:', tFile.path);
									}
								} else if (vChild.data && vChild.data.file instanceof TFile) {
									if (!resultsSet.has(vChild.data.file.path)) {
										results.push(vChild.data.file);
										resultsSet.add(vChild.data.file.path);
										console.log('[Thoughtlands]     ✓ Added from vChild.data.file:', vChild.data.file.path);
									}
								}
							}
						}
					}
				} else {
					console.log('[Thoughtlands] Leaf', leafIndex + 1, '- No vChildren found in view.dom');
				}
				
				// resultDomLookup is typically a map of file paths to DOM elements or result objects
				for (const key of lookupKeys) {
					if (!resultsSet.has(key)) {
						// The key might be a file path
						const tFile = this.app.vault.getAbstractFileByPath(key);
						if (tFile instanceof TFile) {
							results.push(tFile);
							resultsSet.add(key);
							console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from resultDomLookup key:', tFile.path);
						} else {
							// The value might contain the file path
							const value = resultDomLookup[key];
							if (value && typeof value === 'object') {
								// Check if value has a file property
								if (value.file instanceof TFile) {
									if (!resultsSet.has(value.file.path)) {
										results.push(value.file);
										resultsSet.add(value.file.path);
										console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from resultDomLookup value.file:', value.file.path);
									}
								} else if (value.path) {
									const tFile2 = this.app.vault.getAbstractFileByPath(value.path);
									if (tFile2 instanceof TFile && !resultsSet.has(tFile2.path)) {
										results.push(tFile2);
										resultsSet.add(tFile2.path);
										console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from resultDomLookup value.path:', tFile2.path);
									}
								} else if (value.filePath) {
									const tFile3 = this.app.vault.getAbstractFileByPath(value.filePath);
									if (tFile3 instanceof TFile && !resultsSet.has(tFile3.path)) {
										results.push(tFile3);
										resultsSet.add(tFile3.path);
										console.log('[Thoughtlands]   Leaf', leafIndex + 1, '- ✓ Added from resultDomLookup value.filePath:', tFile3.path);
									}
								}
							}
						}
					}
				}
				console.log('[Thoughtlands] Leaf', leafIndex + 1, '- After resultDomLookup: Total =', results.length);
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

			// Try accessing through containerEl (preferred) or contentEl
			const domElement = view.containerEl || view.contentEl;
			if (domElement && typeof domElement.querySelectorAll === 'function') {
				try {
					// First, try to find ALL elements with data-path (most direct approach)
					const allWithDataPath = domElement.querySelectorAll('[data-path]');
					console.log('[Thoughtlands] Searching containerEl for [data-path] elements, found:', allWithDataPath.length);
					if (allWithDataPath && allWithDataPath.length > 0) {
						for (const element of Array.from(allWithDataPath) as Element[]) {
							const filePath = element.getAttribute('data-path');
							if (filePath && !resultsSet.has(filePath)) {
								const tFile = this.app.vault.getAbstractFileByPath(filePath);
								if (tFile instanceof TFile) {
									results.push(tFile);
									resultsSet.add(tFile.path);
									console.log('[Thoughtlands] Successfully extracted file from data-path element:', tFile.path);
								} else {
									console.log('[Thoughtlands] Could not resolve file from data-path:', filePath);
								}
							}
						}
					}
					
					// Also check contentEl if it exists and is different from containerEl
					if (view.contentEl && view.contentEl !== domElement) {
						const contentWithDataPath = view.contentEl.querySelectorAll('[data-path]');
						console.log('[Thoughtlands] Searching contentEl for [data-path] elements, found:', contentWithDataPath.length);
						if (contentWithDataPath && contentWithDataPath.length > 0) {
							for (const element of Array.from(contentWithDataPath) as Element[]) {
								const filePath = element.getAttribute('data-path');
								if (filePath && !resultsSet.has(filePath)) {
									const tFile = this.app.vault.getAbstractFileByPath(filePath);
									if (tFile instanceof TFile) {
										results.push(tFile);
										resultsSet.add(tFile.path);
										console.log('[Thoughtlands] Successfully extracted file from contentEl data-path element:', tFile.path);
									}
								}
							}
						}
					}
					
					// Also try to find tree-item elements with data-path (these contain the file paths)
					// Always check this, even if we found some results - we want ALL results
					const treeItems = domElement.querySelectorAll('.tree-item[data-path]');
					if (treeItems && treeItems.length > 0) {
						console.log('[Thoughtlands] Found', treeItems.length, 'tree-item elements with data-path');
						const elementsArray = Array.from(treeItems) as Element[];
						for (const element of elementsArray) {
							const filePath = element.getAttribute('data-path');
							if (filePath && !resultsSet.has(filePath)) {
								let tFile = this.app.vault.getAbstractFileByPath(filePath);
								if (tFile instanceof TFile) {
									results.push(tFile);
									resultsSet.add(tFile.path);
									console.log('[Thoughtlands] Successfully extracted file from tree-item:', tFile.path);
								}
							}
						}
					}
					
					// CRITICAL: Search results in Obsidian are organized by FILE, not by match
					// Each file can have multiple matches, but we need to extract unique FILES
					// Look for file headers/containers that group matches together
					{
						// Try multiple selectors for file containers
						const fileContainerSelectors = [
							'.search-result-file-matches',
							'.search-result-container',
							'[class*="file-match"]',
							'[class*="file-result"]',
							'.tree-item[data-path]',
							'.nav-file-title',
							'.search-result-file'
						];
						
						let totalFileContainers = 0;
						for (const selector of fileContainerSelectors) {
							const containers = domElement.querySelectorAll(selector);
							if (containers.length > 0) {
								console.log('[Thoughtlands] Found', containers.length, 'file containers using selector:', selector);
								totalFileContainers += containers.length;
								
								// Extract files from containers
								for (const container of Array.from(containers) as Element[]) {
									// Try container itself
									let containerPath = container.getAttribute('data-path') || container.getAttribute('data-href');
									if (!containerPath) {
										// Try first child with data-path or data-href
										const childWithPath = container.querySelector('[data-path], [data-href]');
										if (childWithPath) {
											containerPath = childWithPath.getAttribute('data-path') || childWithPath.getAttribute('data-href');
										}
									}
									// Also try looking for internal links in the container
									if (!containerPath) {
										const link = container.querySelector('a.internal-link');
										if (link) {
											containerPath = link.getAttribute('data-href') || link.getAttribute('href');
										}
									}
									if (containerPath && !resultsSet.has(containerPath)) {
										// Clean up the path (remove .md if needed, handle relative paths)
										let cleanPath = containerPath.replace(/\.md$/, '');
										if (!cleanPath.startsWith('/') && !cleanPath.includes('/')) {
											// Might be just a filename, need to resolve it
											const tFile = this.app.vault.getAbstractFileByPath(containerPath) || 
											                 this.app.vault.getAbstractFileByPath(`${cleanPath}.md`);
											if (tFile instanceof TFile) {
												results.push(tFile);
												resultsSet.add(tFile.path);
												console.log('[Thoughtlands]   ✓ Added from file container (', selector, '):', tFile.path);
											}
										} else {
											const tFile = this.app.vault.getAbstractFileByPath(containerPath);
											if (tFile instanceof TFile) {
												results.push(tFile);
												resultsSet.add(containerPath);
												console.log('[Thoughtlands]   ✓ Added from file container (', selector, '):', tFile.path);
											}
										}
									}
								}
							}
						}
						console.log('[Thoughtlands] Total file containers found:', totalFileContainers);
						
						const selectors = [
							'.search-result-file-title',
							'.tree-item-inner',
							'.tree-item'
						];
						
						let resultElements: NodeListOf<Element> | null = null;
						for (const selector of selectors) {
							resultElements = domElement.querySelectorAll(selector);
							if (resultElements && resultElements.length > 0) {
								console.log('[Thoughtlands] Found', resultElements.length, 'result elements in containerEl using selector:', selector);
								break;
							}
						}
						
						if (resultElements && resultElements.length > 0) {
							// Convert NodeList to Array for iteration
							const elementsArray = Array.from(resultElements);
							for (const element of elementsArray) {
								let filePath: string | null = null;
								
								// Method 1: Use closest() to find ancestor with data-path (most reliable)
								const ancestorWithPath = element.closest('[data-path]');
								if (ancestorWithPath) {
									filePath = ancestorWithPath.getAttribute('data-path');
									if (filePath) {
										console.log('[Thoughtlands] Found data-path using closest():', filePath);
									}
								}
								
								// Method 2: Use closest() to find .tree-item parent, then check for data-path
								if (!filePath) {
									const treeItemParent = element.closest('.tree-item');
									if (treeItemParent) {
										filePath = treeItemParent.getAttribute('data-path');
										if (filePath) {
											console.log('[Thoughtlands] Found data-path on tree-item parent:', filePath);
										} else {
											// Check children of tree-item for data-path
											const pathElement = treeItemParent.querySelector('[data-path]');
											if (pathElement) {
												filePath = pathElement.getAttribute('data-path');
												if (filePath) {
													console.log('[Thoughtlands] Found data-path in tree-item child:', filePath);
												}
											}
										}
									}
								}
								
								// Method 3: Walk up the DOM tree manually (fallback)
								if (!filePath) {
									let currentElement: Element | null = element;
									for (let i = 0; i < 15 && currentElement; i++) {
										filePath = currentElement.getAttribute('data-path');
										if (filePath) {
											console.log('[Thoughtlands] Found data-path on element at level', i, ':', filePath);
											break;
										}
										currentElement = currentElement.parentElement;
									}
								}
								
								// If still no path, try to get from text content or internal link
								if (!filePath) {
									// Look for internal link in the element or its children
									const link = element.querySelector('a.internal-link');
									if (link) {
										filePath = link.getAttribute('data-href') || link.getAttribute('href');
										if (filePath) {
											console.log('[Thoughtlands] Found file path from internal link:', filePath);
										}
									}
									
									// Last resort: try to extract from text content (filename)
									// NOTE: This is unreliable - we should find a better way to get file paths
									if (!filePath && element.textContent) {
										const textContent = element.textContent.trim();
										// Try to match a filename pattern
										const match = textContent.match(/([^\/\n]+\.md)/);
										if (match) {
											filePath = match[1];
											console.log('[Thoughtlands] WARNING: Extracted file path from text (unreliable):', filePath);
											console.log('[Thoughtlands]   Full text content:', textContent);
											console.log('[Thoughtlands]   Element:', element);
											console.log('[Thoughtlands]   Parent:', element.parentElement);
											// Try to find the actual file path in parent elements
											let parent = element.parentElement;
											for (let i = 0; i < 10 && parent; i++) {
												const parentPath = parent.getAttribute('data-path') || parent.getAttribute('data-href');
												if (parentPath) {
													filePath = parentPath;
													console.log('[Thoughtlands]   Found actual path in parent at level', i, ':', filePath);
													break;
												}
												parent = parent.parentElement;
											}
										}
									}
								}
								
								if (filePath) {
									// Clean up the path - remove any leading/trailing whitespace
									filePath = filePath.trim();
									
									// Try to find the file with the path as-is first
									let tFile = this.app.vault.getAbstractFileByPath(filePath);
									
									// If not found and path doesn't end with .md, try adding it
									if (!tFile && !filePath.endsWith('.md')) {
										tFile = this.app.vault.getAbstractFileByPath(`${filePath}.md`);
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
										resultsSet.add(tFile.path);
										console.log('[Thoughtlands] Successfully extracted file:', tFile.path, 'from element');
									} else if (!tFile) {
										console.log('[Thoughtlands] Could not resolve file path:', filePath);
									}
								} else {
									console.log('[Thoughtlands] No file path found in element:', element, 'Parent:', element.parentElement);
								}
							}
						}
					}
				} catch (e) {
					console.log('[Thoughtlands] Error accessing containerEl:', e);
				}
			}
		}

		// Always try comprehensive DOM extraction on all search leaves to ensure we get everything
		// Even if we found some results, there might be more in different parts of the DOM
		if (searchLeaves.length > 0) {
			console.log('[Thoughtlands] Method: Comprehensive DOM extraction');
			console.log('[Thoughtlands]   Processing', searchLeaves.length, 'search leaves (found', results.length, 'results so far)');
			for (let i = 0; i < searchLeaves.length; i++) {
				const leaf = searchLeaves[i];
				const view = leaf.view as any;
				if (view) {
					// Try containerEl
					if (view.containerEl) {
						const beforeCount = results.length;
						console.log('[Thoughtlands]   Leaf', i + 1, '/', searchLeaves.length, '- Extracting from containerEl...');
						const domResults = this.extractFilesFromDOM(view.containerEl, resultsSet);
						if (domResults.length > 0) {
							results.push(...domResults);
							console.log('[Thoughtlands]   Leaf', i + 1, '- containerEl added', domResults.length, 'files (total now:', results.length, ')');
						} else {
							console.log('[Thoughtlands]   Leaf', i + 1, '- containerEl: No additional files found');
						}
					}
					
					// Try contentEl if it's different
					if (view.contentEl && view.contentEl !== view.containerEl) {
						console.log('[Thoughtlands]   Leaf', i + 1, '- Also checking contentEl...');
						const contentResults = this.extractFilesFromDOM(view.contentEl, resultsSet);
						if (contentResults.length > 0) {
							results.push(...contentResults);
							console.log('[Thoughtlands]   Leaf', i + 1, '- contentEl added', contentResults.length, 'files (total now:', results.length, ')');
						}
					}
					
					// Try dom.resultDomLookup if it exists (view.dom is an object, not an Element)
					if (view.dom && view.dom.resultDomLookup && typeof view.dom.resultDomLookup === 'object') {
						console.log('[Thoughtlands]   Leaf', i + 1, '- Checking dom.resultDomLookup...');
						const resultDomLookup = view.dom.resultDomLookup;
						const lookupKeys = Object.keys(resultDomLookup);
						console.log('[Thoughtlands]   Leaf', i + 1, '- resultDomLookup has', lookupKeys.length, 'entries');
						
						for (const key of lookupKeys) {
							if (!resultsSet.has(key)) {
								const tFile = this.app.vault.getAbstractFileByPath(key);
								if (tFile instanceof TFile) {
									results.push(tFile);
									resultsSet.add(key);
									console.log('[Thoughtlands]     ✓ Added from dom.resultDomLookup:', tFile.path);
								} else {
									const value = resultDomLookup[key];
									if (value && typeof value === 'object') {
										if (value.file instanceof TFile && !resultsSet.has(value.file.path)) {
											results.push(value.file);
											resultsSet.add(value.file.path);
											console.log('[Thoughtlands]     ✓ Added from dom.resultDomLookup value.file:', value.file.path);
										} else if (value.path) {
											const tFile2 = this.app.vault.getAbstractFileByPath(value.path);
											if (tFile2 instanceof TFile && !resultsSet.has(tFile2.path)) {
												results.push(tFile2);
												resultsSet.add(tFile2.path);
												console.log('[Thoughtlands]     ✓ Added from dom.resultDomLookup value.path:', tFile2.path);
											} else if (value.filePath) {
												const tFile3 = this.app.vault.getAbstractFileByPath(value.filePath);
												if (tFile3 instanceof TFile && !resultsSet.has(tFile3.path)) {
													results.push(tFile3);
													resultsSet.add(tFile3.path);
													console.log('[Thoughtlands]     ✓ Added from dom.resultDomLookup value.filePath:', tFile3.path);
												}
											}
										}
									}
								}
							}
						}
					}
					
					// Try dom if it exists and is different (but only if it's an Element)
					if (view.dom && view.dom instanceof Element && view.dom !== view.containerEl && view.dom !== view.contentEl) {
						console.log('[Thoughtlands]   Leaf', i + 1, '- Also checking dom as Element...');
						const domResults = this.extractFilesFromDOM(view.dom, resultsSet);
						if (domResults.length > 0) {
							results.push(...domResults);
							console.log('[Thoughtlands]   Leaf', i + 1, '- dom added', domResults.length, 'files (total now:', results.length, ')');
						}
					}
					
					// Try to find all possible container elements within the view
					if (view.containerEl) {
						// Look for nested containers that might have more results
						const nestedContainers = view.containerEl.querySelectorAll('.tree-item-children, .nav-folder-children, .search-result-container, [class*="result"], .tree-item');
						console.log('[Thoughtlands]   Leaf', i + 1, '- Found', nestedContainers.length, 'nested containers');
						for (let j = 0; j < nestedContainers.length; j++) {
							const nestedContainer = nestedContainers[j] as HTMLElement;
							const nestedResults = this.extractFilesFromDOM(nestedContainer, resultsSet);
							if (nestedResults.length > 0) {
								results.push(...nestedResults);
								console.log('[Thoughtlands]   Leaf', i + 1, '- Nested container', j + 1, 'added', nestedResults.length, 'files (total now:', results.length, ')');
							}
						}
					}
				} else {
					console.log('[Thoughtlands]   Leaf', i + 1, '- No view available');
				}
			}
			console.log('[Thoughtlands] After comprehensive DOM extraction: Found', results.length, 'total search results');
		}
		
		// FALLBACK: If we don't have enough results, try to access all properties of the view's dom object
		// to find where the complete results might be stored
		if (results.length < 11 && searchLeaves.length > 0) {
			const firstSearchView = searchLeaves[0].view as any;
			if (firstSearchView && firstSearchView.dom) {
				console.log('[Thoughtlands] FALLBACK: Deep inspection of view.dom properties...');
				const domKeys = Object.keys(firstSearchView.dom);
				console.log('[Thoughtlands]   view.dom has', domKeys.length, 'keys:', domKeys);
				
				// Special handling for vChildren - it's virtualization-related and might contain all results
				if (firstSearchView.dom.vChildren && typeof firstSearchView.dom.vChildren === 'object') {
					console.log('[Thoughtlands]   SPECIAL: Inspecting dom.vChildren (virtualization container)');
					const vChildren = firstSearchView.dom.vChildren as any;
					
					// Check if it's a Map
					if (vChildren instanceof Map) {
						console.log('[Thoughtlands]     vChildren is a Map with', vChildren.size, 'entries');
						for (const [key, value] of vChildren.entries()) {
							if (typeof key === 'string' && key.includes('.md') && !resultsSet.has(key)) {
								const tFile = this.app.vault.getAbstractFileByPath(key);
								if (tFile instanceof TFile) {
									results.push(tFile);
									resultsSet.add(key);
									console.log('[Thoughtlands]       ✓ Added from vChildren Map key:', tFile.path);
								}
							}
							if (value && typeof value === 'object') {
								if (value.file instanceof TFile && !resultsSet.has(value.file.path)) {
									results.push(value.file);
									resultsSet.add(value.file.path);
									console.log('[Thoughtlands]       ✓ Added from vChildren Map value.file:', value.file.path);
								} else if (value.path && typeof value.path === 'string') {
									const tFile = this.app.vault.getAbstractFileByPath(value.path);
									if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
										results.push(tFile);
										resultsSet.add(tFile.path);
										console.log('[Thoughtlands]       ✓ Added from vChildren Map value.path:', tFile.path);
									}
								}
							}
						}
					} else {
						// It's a regular object
						const vChildrenKeys = Object.keys(vChildren);
						console.log('[Thoughtlands]     vChildren is an object with', vChildrenKeys.length, 'keys');
						for (const vKey of vChildrenKeys) {
							// Check if key is a file path
							if (!resultsSet.has(vKey) && typeof vKey === 'string' && vKey.includes('.md')) {
								const tFile = this.app.vault.getAbstractFileByPath(vKey);
								if (tFile instanceof TFile) {
									results.push(tFile);
									resultsSet.add(vKey);
									console.log('[Thoughtlands]       ✓ Added from vChildren key:', tFile.path);
								}
							}
							// Check the value
							const vValue = vChildren[vKey];
							if (vValue && typeof vValue === 'object') {
								if (vValue.file instanceof TFile && !resultsSet.has(vValue.file.path)) {
									results.push(vValue.file);
									resultsSet.add(vValue.file.path);
									console.log('[Thoughtlands]       ✓ Added from vChildren[' + vKey + '].file:', vValue.file.path);
								} else if (vValue.path && typeof vValue.path === 'string') {
									const tFile = this.app.vault.getAbstractFileByPath(vValue.path);
									if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
										results.push(tFile);
										resultsSet.add(tFile.path);
										console.log('[Thoughtlands]       ✓ Added from vChildren[' + vKey + '].path:', tFile.path);
									}
								}
							}
						}
					}
				}
				
				// Check for any array-like properties that might contain results
				for (const key of domKeys) {
					// Skip vChildren as we already handled it
					if (key === 'vChildren') continue;
					
					const value = firstSearchView.dom[key];
					if (Array.isArray(value) && value.length > 0) {
						console.log('[Thoughtlands]   Found array property dom.' + key + ' with', value.length, 'items');
						// Check if items in array have file properties
						for (let i = 0; i < Math.min(value.length, 20); i++) {
							const item = value[i];
							if (item && typeof item === 'object') {
								if (item.file instanceof TFile && !resultsSet.has(item.file.path)) {
									results.push(item.file);
									resultsSet.add(item.file.path);
									console.log('[Thoughtlands]     ✓ Added from dom.' + key + '[' + i + '].file:', item.file.path);
								} else if (item.path && typeof item.path === 'string') {
									const tFile = this.app.vault.getAbstractFileByPath(item.path);
									if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
										results.push(tFile);
										resultsSet.add(tFile.path);
										console.log('[Thoughtlands]     ✓ Added from dom.' + key + '[' + i + '].path:', tFile.path);
									}
								}
							}
						}
					} else if (value && typeof value === 'object' && !Array.isArray(value)) {
						// Check if it's a Map or object with file paths as keys
						const valueKeys = Object.keys(value);
						if (valueKeys.length > 0 && valueKeys.length < 200) {
							console.log('[Thoughtlands]   Found object property dom.' + key + ' with', valueKeys.length, 'keys');
							for (const vKey of valueKeys.slice(0, 50)) {
								// Check if key is a file path
								if (!resultsSet.has(vKey) && typeof vKey === 'string' && vKey.includes('.md')) {
									const tFile = this.app.vault.getAbstractFileByPath(vKey);
									if (tFile instanceof TFile) {
										results.push(tFile);
										resultsSet.add(vKey);
										console.log('[Thoughtlands]     ✓ Added from dom.' + key + ' key:', tFile.path);
									}
								}
								// Check the value
								const vValue = value[vKey];
								if (vValue && typeof vValue === 'object') {
									if (vValue.file instanceof TFile && !resultsSet.has(vValue.file.path)) {
										results.push(vValue.file);
										resultsSet.add(vValue.file.path);
										console.log('[Thoughtlands]     ✓ Added from dom.' + key + '[' + vKey + '].file:', vValue.file.path);
									} else if (vValue.path && typeof vValue.path === 'string') {
										const tFile = this.app.vault.getAbstractFileByPath(vValue.path);
										if (tFile instanceof TFile && !resultsSet.has(tFile.path)) {
											results.push(tFile);
											resultsSet.add(tFile.path);
											console.log('[Thoughtlands]     ✓ Added from dom.' + key + '[' + vKey + '].path:', tFile.path);
										}
									}
								}
							}
						}
					}
				}
				console.log('[Thoughtlands] After deep dom inspection: Total =', results.length);
			}
		}
		
		// Remove duplicates and log final count
		const uniqueResults = Array.from(new Map(results.map(f => [f.path, f])).values());
		if (uniqueResults.length !== results.length) {
			console.warn('[Thoughtlands] Found duplicate files in results. Original:', results.length, 'Unique:', uniqueResults.length);
			results.length = 0;
			results.push(...uniqueResults);
		}
		
		// Log detailed extraction summary
		console.log('[Thoughtlands] ===== SEARCH EXTRACTION SUMMARY =====');
		console.log('[Thoughtlands] Final extraction result: Found', results.length, 'unique search results');
		console.log('[Thoughtlands] Extracted file paths:', results.map(f => f.path));
		
		// If we found fewer results than expected, warn the user
		if (results.length < 11) {
			console.warn('[Thoughtlands] ⚠️  WARNING: Only found', results.length, 'files, but expected 11.');
			console.warn('[Thoughtlands] This might mean:');
			console.warn('[Thoughtlands]   1. Some files are in collapsed sections - try expanding all sections in the search view');
			console.warn('[Thoughtlands]   2. Some files are not yet rendered (virtualization) - try scrolling to the bottom of the search results');
			console.warn('[Thoughtlands]   3. The search view only stores a subset of results in its internal data structures');
			console.warn('[Thoughtlands]   4. The missing files might be in a different search result group or category');
		}
		
		console.log('[Thoughtlands] ======================================');
		
		if (results.length === 0) {
			const allLeafTypes: string[] = [];
			this.app.workspace.iterateAllLeaves((leaf) => {
				allLeafTypes.push(leaf.view.getViewType());
			});
			const activeLeaf = this.app.workspace.activeLeaf;
			console.log('[Thoughtlands] No results found. Debug info:', {
				searchLeavesCount: searchLeaves.length,
				activeLeafType: activeLeaf?.view?.getViewType(),
				allLeaves: allLeafTypes
			});
		}
		
		return results;
	}
	
	private extractFilesFromDOM(containerEl: HTMLElement, resultsSet: Set<string>): TFile[] {
		const files: TFile[] = [];
		
		try {
			// First, try the most comprehensive approach: find ALL elements with data-path recursively
			// This should catch files regardless of their DOM structure
			const allWithPath = containerEl.querySelectorAll('[data-path]');
			console.log('[Thoughtlands] DOM extraction: Found', allWithPath.length, 'total elements with data-path attribute');
			
			const foundPaths = new Set<string>();
			for (const element of Array.from(allWithPath)) {
				const filePath = element.getAttribute('data-path');
				if (filePath) {
					foundPaths.add(filePath);
					if (!resultsSet.has(filePath)) {
						const tFile = this.app.vault.getAbstractFileByPath(filePath);
						if (tFile instanceof TFile) {
							files.push(tFile);
							resultsSet.add(filePath);
							console.log('[Thoughtlands] Extracted file from data-path element:', tFile.path);
						} else {
							console.log('[Thoughtlands] Could not resolve file path from data-path:', filePath);
						}
					}
				}
			}
			
			console.log('[Thoughtlands] DOM extraction: Found', foundPaths.size, 'unique file paths in DOM, extracted', files.length, 'new files');
			console.log('[Thoughtlands] DOM extraction: File paths found:', Array.from(foundPaths));
			
			// Check for collapsed sections that might contain more results
			// Obsidian search results might be in collapsible sections
			const collapsedSections = containerEl.querySelectorAll('.tree-item.is-collapsed, .tree-item.collapsed, [data-collapsed="true"]');
			console.log('[Thoughtlands] DOM extraction: Found', collapsedSections.length, 'collapsed sections');
			if (collapsedSections.length > 0) {
				console.log('[Thoughtlands] WARNING: There are collapsed sections that might contain more results!');
			}
			
			// Try to find all search result containers, not just the main one
			const searchContainers = containerEl.querySelectorAll('.search-result-container, .search-results, .tree-item-children, .nav-folder-children, .tree-item');
			console.log('[Thoughtlands] DOM extraction: Found', searchContainers.length, 'potential search result containers');
			
			// Check each container for additional files
			for (let i = 0; i < searchContainers.length; i++) {
				const container = searchContainers[i] as HTMLElement;
				const containerFiles = container.querySelectorAll('[data-path]');
				if (containerFiles.length > 0) {
					console.log('[Thoughtlands]   Container', i + 1, '- Found', containerFiles.length, 'elements with data-path');
					for (const element of Array.from(containerFiles)) {
						const filePath = element.getAttribute('data-path');
						if (filePath && !resultsSet.has(filePath)) {
							const tFile = this.app.vault.getAbstractFileByPath(filePath);
							if (tFile instanceof TFile) {
								files.push(tFile);
								resultsSet.add(filePath);
								console.log('[Thoughtlands]   Container', i + 1, '- Extracted:', tFile.path);
							}
						}
					}
				}
			}
			
			// Also check the entire document for any search result elements we might have missed
			// Sometimes results are in a different part of the DOM tree (e.g., in a different pane)
			const allSearchResultsInDoc = document.querySelectorAll('.search-result-file-title, .tree-item[data-path], [data-path]');
			console.log('[Thoughtlands] DOM extraction: Found', allSearchResultsInDoc.length, 'total search result elements in entire document');
			
			// Check if there are any elements outside the main container
			let outsideCount = 0;
			for (const element of Array.from(allSearchResultsInDoc)) {
				// Only process if it's not already in our container (to avoid duplicates)
				if (!containerEl.contains(element)) {
					const filePath = element.getAttribute('data-path');
					if (filePath && !resultsSet.has(filePath)) {
						const tFile = this.app.vault.getAbstractFileByPath(filePath);
						if (tFile instanceof TFile) {
							files.push(tFile);
							resultsSet.add(filePath);
							outsideCount++;
							console.log('[Thoughtlands] Extracted file from outside container:', tFile.path);
						}
					}
				}
			}
			if (outsideCount > 0) {
				console.log('[Thoughtlands] DOM extraction: Found', outsideCount, 'files outside the main container');
			}
			
			// Check for virtualized lists or scrollable containers that might have more items
			const scrollableContainers = containerEl.querySelectorAll('.tree-item-children, .nav-folder-children, [class*="scroll"], [class*="virtual"]');
			console.log('[Thoughtlands] DOM extraction: Found', scrollableContainers.length, 'scrollable/virtual containers');
			
			// Also check the entire document for any search result elements we might have missed
			// Sometimes results are in a different part of the DOM tree
			const allSearchResults = document.querySelectorAll('.search-result-file-title, .tree-item[data-path], [data-path]');
			console.log('[Thoughtlands] DOM extraction: Found', allSearchResults.length, 'total search result elements in entire document');
			
			// Check if there are any elements outside the main container
			for (const element of Array.from(allSearchResults)) {
				// Only process if it's not already in our container (to avoid duplicates)
				if (!containerEl.contains(element)) {
					const filePath = element.getAttribute('data-path');
					if (filePath && !resultsSet.has(filePath)) {
						const tFile = this.app.vault.getAbstractFileByPath(filePath);
						if (tFile instanceof TFile) {
							files.push(tFile);
							resultsSet.add(filePath);
							console.log('[Thoughtlands] Extracted file from outside container:', tFile.path);
						}
					}
				}
			}
			
			// Also try tree-item elements specifically (in case they have a different structure)
			const treeItems = containerEl.querySelectorAll('.tree-item[data-path]');
			if (treeItems && treeItems.length > 0) {
				console.log('[Thoughtlands] DOM extraction: Also found', treeItems.length, 'tree-item elements with data-path');
				for (const element of Array.from(treeItems)) {
					const filePath = element.getAttribute('data-path');
					if (filePath && !resultsSet.has(filePath)) {
						const tFile = this.app.vault.getAbstractFileByPath(filePath);
						if (tFile instanceof TFile) {
							files.push(tFile);
							resultsSet.add(filePath);
							console.log('[Thoughtlands] Extracted file from tree-item:', tFile.path);
						}
					}
				}
			}
			
			// Always look for search-result-file-title and find parent tree-item (don't skip if we found some files)
			const fileTitles = containerEl.querySelectorAll('.search-result-file-title');
			console.log('[Thoughtlands] Found', fileTitles.length, 'search-result-file-title elements');
			for (const titleEl of Array.from(fileTitles)) {
				// Use closest() to find ancestor with data-path
				const ancestorWithPath = titleEl.closest('[data-path]');
				if (ancestorWithPath) {
					const filePath = ancestorWithPath.getAttribute('data-path');
					if (filePath && !resultsSet.has(filePath)) {
						const tFile = this.app.vault.getAbstractFileByPath(filePath);
						if (tFile instanceof TFile) {
							files.push(tFile);
							resultsSet.add(filePath);
							console.log('[Thoughtlands] Extracted file from ancestor with data-path:', tFile.path);
							continue;
						}
					}
				}
				
				// Fallback: Find .tree-item parent
				const treeItemParent = titleEl.closest('.tree-item');
				if (treeItemParent) {
					const filePath = treeItemParent.getAttribute('data-path');
					if (filePath && !resultsSet.has(filePath)) {
						const tFile = this.app.vault.getAbstractFileByPath(filePath);
						if (tFile instanceof TFile) {
							files.push(tFile);
							resultsSet.add(filePath);
							console.log('[Thoughtlands] Extracted file from tree-item parent:', tFile.path);
						}
					}
				}
			}
			
			// Always look for internal links (don't skip if we found some files)
			const links = containerEl.querySelectorAll('a.internal-link[data-href]');
			console.log('[Thoughtlands] Found', links.length, 'internal links with data-href');
			for (const link of Array.from(links)) {
				const href = link.getAttribute('data-href');
				if (href && !resultsSet.has(href)) {
					const tFile = this.app.vault.getAbstractFileByPath(href);
					if (tFile instanceof TFile) {
						files.push(tFile);
						resultsSet.add(href);
						console.log('[Thoughtlands] Extracted file from internal link:', tFile.path);
					}
				}
			}
		} catch (e) {
			console.log('[Thoughtlands] Error in DOM extraction:', e);
		}
		
		return files;
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
			// Check which notes already have embeddings to avoid generating new ones
			const storageService = this.embeddingService.getStorageService();
			const noteEmbeddings: { file: TFile; embedding: number[] }[] = [];
			const notesNeedingEmbeddings: TFile[] = [];
			
			// First pass: check which notes already have embeddings
			for (const note of notes) {
				const existingEmbedding = await storageService.getEmbedding(note);
				if (existingEmbedding) {
					noteEmbeddings.push({ file: note, embedding: existingEmbedding });
				} else {
					notesNeedingEmbeddings.push(note);
				}
			}
			
			console.log(`[Thoughtlands] ${noteEmbeddings.length} notes already have embeddings, ${notesNeedingEmbeddings.length} need new embeddings`);
			
			// Only generate embeddings for notes that don't have them (with rate limiting)
			if (notesNeedingEmbeddings.length > 0) {
				console.log('[Thoughtlands] Generating embeddings for', notesNeedingEmbeddings.length, 'notes...');
				
				for (let i = 0; i < notesNeedingEmbeddings.length; i++) {
					const note = notesNeedingEmbeddings[i];
					try {
						const embedding = await this.embeddingService.generateEmbeddingForFile(note);
						noteEmbeddings.push({ file: note, embedding });
						
						// Add delay between requests to avoid overwhelming Ollama (except for last item)
						if (i < notesNeedingEmbeddings.length - 1) {
							await new Promise(resolve => setTimeout(resolve, 300)); // 300ms delay between requests
						}
					} catch (error) {
						console.warn('[Thoughtlands] Failed to generate embedding for', note.path, error);
						// Skip note if embedding fails - don't include it with empty embedding
						// This prevents 500 errors from cascading
						
						// If we get a 500 error, add a longer delay to let Ollama recover
						if (error instanceof Error && error.message.includes('500')) {
							console.warn('[Thoughtlands] Ollama 500 error detected, adding recovery delay...');
							await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay after 500 error
						}
					}
				}
			}

			// Generate embedding for the concepts
			const conceptText = concepts.join(' ');
			let conceptEmbedding: number[];
			try {
				conceptEmbedding = await this.embeddingService.generateEmbedding(conceptText);
			} catch (error) {
				console.error('[Thoughtlands] Failed to generate concept embedding:', error);
				// If we can't generate concept embedding, return all notes
				return notes;
			}

			// Calculate similarity and filter
			const relevantNotes: TFile[] = [];
			const filteredOut: { file: TFile; similarity: number }[] = [];
			
			for (const { file, embedding } of noteEmbeddings) {
				if (embedding.length === 0) {
					// If embedding failed, skip the note (don't include it)
					// This ensures we only use notes with valid embeddings
					console.log(`[Thoughtlands] Skipping ${file.path} - no valid embedding available`);
					continue;
				}

				const similarity = this.embeddingService.cosineSimilarity(conceptEmbedding, embedding);
				if (similarity >= this.settings.embeddingSimilarityThreshold) {
					relevantNotes.push(file);
				} else {
					filteredOut.push({ file, similarity });
					console.log(`[Thoughtlands] Filtering out ${file.path} (similarity: ${similarity.toFixed(3)}, threshold: ${this.settings.embeddingSimilarityThreshold})`);
				}
			}

			if (filteredOut.length > 0) {
				console.log(`[Thoughtlands] Embedding filtering removed ${filteredOut.length} note${filteredOut.length !== 1 ? 's' : ''} below similarity threshold`);
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

