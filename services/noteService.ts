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
		return this.vault.getMarkdownFiles();
	}

	getNotesByTags(tags: string[]): TFile[] {
		const allNotes = this.getAllNotes();
		const notesWithTags: TFile[] = [];

		for (const file of allNotes) {
			const fileCache = this.metadataCache.getFileCache(file);
			if (!fileCache) continue;

			const fileTags = this.extractTags(fileCache);
			const hasAnyTag = tags.some(tag => 
				fileTags.some(ft => 
					ft.toLowerCase() === tag.toLowerCase().replace(/^#/, '')
				)
			);

			if (hasAnyTag) {
				notesWithTags.push(file);
			}
		}

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

	updateSettings(newSettings: ThoughtlandsSettings): void {
		this.settings = newSettings;
	}
}

