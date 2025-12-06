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

	filterNotesByIgnores(files: TFile[]): TFile[] {
		const filtered = files.filter(file => {
			const filePath = file.path.toLowerCase();
			
			// Check included paths (if specified)
			if (this.settings.includedPaths.length > 0) {
				const isIncluded = this.settings.includedPaths.some(included => 
					filePath.startsWith(included.toLowerCase()) || 
					filePath.includes(included.toLowerCase())
				);
				if (!isIncluded) {
					return false;
				}
			}
			
			// Check ignored paths
			const isIgnored = this.settings.ignoredPaths.some(ignored => 
				filePath.includes(ignored.toLowerCase())
			);
			if (isIgnored) {
				return false;
			}
			
			return true;
		});
		// Only log summary if there's a significant difference
		if (files.length > 10 && filtered.length < files.length * 0.5) {
			console.log('[Thoughtlands:RegionService] Path filtering:', {
				original: files.length,
				filtered: filtered.length,
				includedPaths: this.settings.includedPaths,
				ignoredPaths: this.settings.ignoredPaths
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

