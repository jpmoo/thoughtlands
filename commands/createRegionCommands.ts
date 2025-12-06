import { App, TFile, Workspace, Notice } from 'obsidian';
import { RegionService } from '../services/regionService';
import { NoteService } from '../services/noteService';
import { OpenAIService } from '../services/openAIService';
import { Region } from '../models/region';
import { ThoughtlandsSettings } from '../settings/thoughtlandsSettings';
import { SimplePromptModal } from '../ui/simplePromptModal';
import { ColorPickerModal } from '../ui/colorPickerModal';

export class CreateRegionCommands {
	private app: App;
	private regionService: RegionService;
	private noteService: NoteService;
	private openAIService: OpenAIService;
	private settings: ThoughtlandsSettings;

	constructor(
		app: App,
		regionService: RegionService,
		noteService: NoteService,
		openAIService: OpenAIService,
		settings: ThoughtlandsSettings
	) {
		this.app = app;
		this.regionService = regionService;
		this.noteService = noteService;
		this.openAIService = openAIService;
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
		// Prompt for concepts
		const conceptsInput = await this.promptForConcepts();
		if (!conceptsInput) return;

		const concepts = conceptsInput
			.split(',')
			.map(c => c.trim())
			.filter(c => c.length > 0);

		if (concepts.length === 0) {
			new Notice('No concepts provided.');
			return;
		}

		// Get related tags from OpenAI
		new Notice('Querying AI for related tags...');

		const aiResponse = await this.openAIService.getRelatedTags(concepts);
		
		if (!aiResponse.success || !aiResponse.tags || aiResponse.tags.length === 0) {
			new Notice(aiResponse.error || 'Failed to get related tags from AI.');
			return;
		}

		// Filter tags by ignores
		const filteredTags = this.regionService.filterTagsByIgnores(aiResponse.tags);

		if (filteredTags.length === 0) {
			new Notice('All suggested tags were filtered out.');
			return;
		}

		// Get all notes with those tags
		const notes = this.noteService.getNotesByTags(filteredTags);
		const finalNotes = this.regionService.filterNotesByIgnores(notes);

		if (finalNotes.length === 0) {
			new Notice('No notes found with the suggested tags.');
			return;
		}

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
			'concept',
			{
				type: 'concept',
				concepts: concepts,
			},
			notePaths
		);

		new Notice(`Region "${name}" created with ${notePaths.length} notes from AI-suggested tags.`);
	}

	private getActiveSearchResults(): TFile[] {
		// Try to get search results from the active search view
		const searchView = this.app.workspace.getLeavesOfType('search')[0];
		if (!searchView) {
			return [];
		}

		// Access search results through the view
		const view = searchView.view as any;
		if (!view || !view.dom) {
			return [];
		}

		// Get files from search results
		// Obsidian's search view stores results in view.resultDomLookup
		const results: TFile[] = [];
		if (view.resultDomLookup) {
			for (const file of Object.keys(view.resultDomLookup)) {
				const tFile = this.app.vault.getAbstractFileByPath(file);
				if (tFile instanceof TFile) {
					results.push(tFile);
				}
			}
		}

		// Alternative: try to get from search results directly
		if (results.length === 0 && view.searchResults) {
			for (const result of view.searchResults) {
				if (result.file instanceof TFile) {
					results.push(result.file);
				}
			}
		}

		return results;
	}

	private async promptForName(): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new SimplePromptModal(
				this.app,
				'Region Name',
				'Enter region name',
				(result: string) => {
					resolve(result.trim() || null);
				}
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

	private async promptForConcepts(): Promise<string | null> {
		return new Promise((resolve) => {
			const modal = new SimplePromptModal(
				this.app,
				'Concepts',
				'Enter concepts (comma-separated)',
				(result: string) => {
					resolve(result.trim() || null);
				}
			);
			modal.open();
		});
	}
}

