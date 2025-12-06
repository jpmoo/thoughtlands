import { TFile, MetadataCache, Vault } from 'obsidian';
import { ThoughtlandsSettings } from '../settings/thoughtlandsSettings';

export class NoteService {
	private metadataCache: MetadataCache;
	private vault: Vault;
	private settings: ThoughtlandsSettings;

	constructor(metadataCache: MetadataCache, vault: Vault, settings: ThoughtlandsSettings) {
		this.metadataCache = metadataCache;
		this.vault = vault;
		this.settings = settings;
	}

	getAllNotes(): TFile[] {
		let notes = this.vault.getMarkdownFiles();
		
		// Apply included paths filter if set
		if (this.settings.includedPaths.length > 0) {
			notes = notes.filter(file => {
				const filePath = file.path.toLowerCase();
				return this.settings.includedPaths.some(included => 
					filePath.startsWith(included.toLowerCase()) || 
					filePath.includes(included.toLowerCase())
				);
			});
		}
		
		return notes;
	}

	getNotesByTags(tags: string[]): TFile[] {
		console.log('[Thoughtlands:NoteService] getNotesByTags called with tags:', tags);
		const allNotes = this.getAllNotes();
		console.log('[Thoughtlands:NoteService] Total notes in vault:', allNotes.length);

		const notesWithTags: TFile[] = [];
		const tagSearchLower = tags.map(t => t.toLowerCase().replace(/^#/, ''));

		for (const file of allNotes) {
			const fileCache = this.metadataCache.getFileCache(file);
			if (!fileCache) {
				console.log('[Thoughtlands:NoteService] No cache for file:', file.path);
				continue;
			}

			const fileTags = this.extractTags(fileCache);
			const fileTagsLower = fileTags.map(ft => ft.toLowerCase());
			
			// Check if file has any of the search tags
			const hasAnyTag = tagSearchLower.some(searchTag => 
				fileTagsLower.includes(searchTag)
			);

			// If included tags are specified, also check if file has at least one included tag
			let passesIncludedFilter = true;
			if (this.settings.includedTags.length > 0) {
				passesIncludedFilter = fileTagsLower.some(fileTag =>
					this.settings.includedTags.some(included =>
						included.toLowerCase() === fileTag
					)
				);
			}

			if (hasAnyTag && passesIncludedFilter) {
				console.log('[Thoughtlands:NoteService] Match found:', {
					file: file.path,
					fileTags: fileTags,
					matchedTags: tagSearchLower.filter(st => fileTagsLower.includes(st))
				});
				notesWithTags.push(file);
			}
		}

		console.log('[Thoughtlands:NoteService] Notes found with tags:', {
			searchTags: tags,
			foundCount: notesWithTags.length,
			foundFiles: notesWithTags.map(f => f.path)
		});

		return notesWithTags;
	}

	getTagsFromNotes(notes: TFile[]): string[] {
		const tagSet = new Set<string>();

		for (const file of notes) {
			const fileCache = this.metadataCache.getFileCache(file);
			if (!fileCache) continue;

			const tags = this.extractTags(fileCache);
			tags.forEach(tag => tagSet.add(tag));
		}

		return Array.from(tagSet);
	}

	getAllTags(): string[] {
		const tagSet = new Set<string>();
		const allNotes = this.getAllNotes();

		for (const file of allNotes) {
			const fileCache = this.metadataCache.getFileCache(file);
			if (!fileCache) continue;

			const tags = this.extractTags(fileCache);
			tags.forEach(tag => tagSet.add(tag)); // Keep original case
		}

		return Array.from(tagSet);
	}

	async getTagSamples(tags: string[], maxSamplesPerTag: number = 3): Promise<Map<string, string[]>> {
		const tagSamples = new Map<string, string[]>();
		
		// Get all notes
		const allNotes = this.getAllNotes();
		
		// For each tag, find notes with that tag and extract excerpts
		for (const tag of tags) {
			const tagLower = tag.toLowerCase().replace(/^#/, '');
			const samples: string[] = [];
			
			for (const file of allNotes) {
				if (samples.length >= maxSamplesPerTag) break;
				
				const fileCache = this.metadataCache.getFileCache(file);
				if (!fileCache) continue;
				
				const fileTags = this.extractTags(fileCache);
				const fileTagsLower = fileTags.map(ft => ft.toLowerCase());
				
				if (fileTagsLower.includes(tagLower)) {
					// Try to get excerpt from file content
					try {
						const content = await this.vault.read(file);
						// Extract first meaningful paragraph or first 300 chars
						const lines = content.split('\n').filter(line => line.trim().length > 20);
						if (lines.length > 0) {
							const excerpt = lines[0].trim().substring(0, 300);
							if (excerpt.length > 0) {
								samples.push(excerpt);
							}
						}
					} catch (error) {
						// Skip if can't read file
						console.log('[Thoughtlands:NoteService] Could not read file for tag sample:', file.path);
					}
				}
			}
			
			if (samples.length > 0) {
				tagSamples.set(tag, samples);
			}
		}
		
		return tagSamples;
	}

	private extractTags(fileCache: any): string[] {
		const tags: string[] = [];

		// Extract from frontmatter tags
		if (fileCache.frontmatter?.tags) {
			const frontmatterTags = Array.isArray(fileCache.frontmatter.tags)
				? fileCache.frontmatter.tags
				: [fileCache.frontmatter.tags];
			frontmatterTags.forEach((tag: string) => {
				tags.push(tag.replace(/^#/, ''));
			});
		}

		// Extract from tag list in cache
		if (fileCache.tags) {
			fileCache.tags.forEach((tag: any) => {
				if (tag.tag) {
					tags.push(tag.tag.replace(/^#/, ''));
				}
			});
		}

		return tags;
	}

	getAllTagsInVault(): string[] {
		// Alias for getAllTags but returns lowercase tags
		return this.getAllTags().map(tag => tag.toLowerCase());
	}

	updateSettings(newSettings: ThoughtlandsSettings): void {
		this.settings = newSettings;
	}
}

