import { TFile } from 'obsidian';
import { Region, RegionsData } from '../models/region';
import { ThoughtlandsSettings } from '../settings/thoughtlandsSettings';

export class RegionService {
	private settings: ThoughtlandsSettings;
	private regions: Region[] = [];

	constructor(settings: ThoughtlandsSettings) {
		this.settings = settings;
	}

	async loadRegions(): Promise<void> {
		// Regions will be loaded from plugin data storage
		// This is a placeholder - actual loading will be done by the plugin
	}

	setRegions(regions: Region[]): void {
		this.regions = regions;
	}

	getRegions(): Region[] {
		return [...this.regions];
	}

	createRegion(
		name: string,
		color: string,
		mode: Region['mode'],
		source: Region['source'],
		notes: string[]
	): Region {
		const region: Region = {
			id: `region_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
			name,
			color,
			mode,
			source,
			createdAt: new Date().toISOString(),
			updatedAt: new Date().toISOString(),
			notes: [...notes],
		};

		this.regions.push(region);
		return region;
	}

	updateRegion(id: string, updates: Partial<Region>): Region | null {
		const region = this.regions.find(r => r.id === id);
		if (!region) return null;

		Object.assign(region, updates);
		region.updatedAt = new Date().toISOString();
		return region;
	}

	deleteRegion(id: string): boolean {
		const index = this.regions.findIndex(r => r.id === id);
		if (index === -1) return false;

		this.regions.splice(index, 1);
		return true;
	}

	getRegion(id: string): Region | null {
		return this.regions.find(r => r.id === id) || null;
	}

	filterNotesByIgnores(files: TFile[], metadataCache?: any, noteService?: any): TFile[] {
		const isBatch = files.length > 1;
		
		// Log filter settings for debugging (only for batches, not individual files)
		if (isBatch) {
			console.log('[Thoughtlands:RegionService] Filtering files with settings:', {
				includedPaths: this.settings.includedPaths,
				ignoredPaths: this.settings.ignoredPaths,
				includedTags: this.settings.includedTags,
				ignoredTags: this.settings.ignoredTags,
				totalFiles: files.length
			});
		}
		
		const filtered = files.filter(file => {
			const filePath = file.path.toLowerCase();
			
			// Check included paths (if specified)
			if (this.settings.includedPaths.length > 0) {
				const isIncluded = this.settings.includedPaths.some(included => {
					const includedLower = included.toLowerCase();
					const startsWith = filePath.startsWith(includedLower);
					const includes = filePath.includes(includedLower);
					if (startsWith || includes && isBatch) {
						console.log(`[Thoughtlands:RegionService] File ${file.path} matches included path: ${included}`);
					}
					return startsWith || includes;
				});
				if (!isIncluded) {
					// Only log for batches, not individual file checks
					if (isBatch) {
						console.log(`[Thoughtlands:RegionService] Filtering out ${file.path} (not in included paths: ${this.settings.includedPaths.join(', ')})`);
					}
					return false;
				}
			}
			
			// Check ignored paths
			const isIgnored = this.settings.ignoredPaths.some(ignored => {
				const ignoredLower = ignored.toLowerCase();
				return filePath.includes(ignoredLower);
			});
			if (isIgnored) {
				// Only log for batches, not individual file checks
				if (isBatch) {
					console.log(`[Thoughtlands:RegionService] Filtering out ${file.path} (in ignored paths)`);
				}
				return false;
			}
			
			// Check tags if metadataCache and noteService are provided
			if (metadataCache && noteService) {
				const fileCache = metadataCache.getFileCache(file);
				if (fileCache) {
					const fileTags = noteService['extractTags'](fileCache);
					const fileTagsLower = fileTags.map((ft: string) => ft.toLowerCase());
					
					// Check ignored tags
					const hasIgnoredTag = this.settings.ignoredTags.some(ignored => {
						const ignoredLower = ignored.toLowerCase();
						return fileTagsLower.includes(ignoredLower);
					});
					if (hasIgnoredTag) {
						if (isBatch) {
							console.log(`[Thoughtlands:RegionService] Filtering out ${file.path} (has ignored tag)`);
						}
						return false;
					}
					
					// Check included tags (if specified)
					if (this.settings.includedTags.length > 0) {
						const hasIncludedTag = fileTagsLower.some((fileTag: string) =>
							this.settings.includedTags.some(included =>
								included.toLowerCase() === fileTag
							)
						);
						if (!hasIncludedTag) {
							if (isBatch) {
								console.log(`[Thoughtlands:RegionService] Filtering out ${file.path} (no included tags). File tags: [${fileTags.join(', ')}], Required tags: [${this.settings.includedTags.join(', ')}]`);
							}
							return false;
						}
					}
				} else {
					// If no file cache, check if we should exclude it
					// For included tags, if no cache, we can't verify tags, so exclude it
					if (this.settings.includedTags.length > 0) {
						if (isBatch) {
							console.log(`[Thoughtlands:RegionService] Filtering out ${file.path} (no file cache, cannot verify included tags)`);
						}
						return false;
					}
				}
			}
			
			return true;
		});
		
		// Log summary only for batches
		if (isBatch) {
			console.log('[Thoughtlands:RegionService] Filtering result:', {
				original: files.length,
				filtered: filtered.length,
				excluded: files.length - filtered.length,
				includedPaths: this.settings.includedPaths,
				ignoredPaths: this.settings.ignoredPaths,
				includedTags: this.settings.includedTags,
				ignoredTags: this.settings.ignoredTags
			});
		}
		
		return filtered;
	}

	filterTagsByIgnores(tags: string[]): string[] {
		const filtered = tags.filter(tag => {
			const tagName = tag.replace(/^#/, '').toLowerCase();
			const isIgnored = this.settings.ignoredTags.some(ignored => 
				ignored.toLowerCase() === tagName
			);
			if (isIgnored) {
				console.log('[Thoughtlands:RegionService] Filtering out ignored tag:', tag);
			}
			return !isIgnored;
		});
		console.log('[Thoughtlands:RegionService] Tag filtering:', {
			original: tags.length,
			filtered: filtered.length,
			ignoredTags: this.settings.ignoredTags
		});
		return filtered;
	}

	exportToJSON(): RegionsData {
		return {
			regions: this.regions,
		};
	}

	updateSettings(newSettings: ThoughtlandsSettings): void {
		this.settings = newSettings;
	}
}

