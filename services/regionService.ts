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
		return files.filter(file => {
			// Check ignored paths
			const filePath = file.path.toLowerCase();
			if (this.settings.ignoredPaths.some(ignored => 
				filePath.includes(ignored.toLowerCase())
			)) {
				return false;
			}
			return true;
		});
	}

	filterTagsByIgnores(tags: string[]): string[] {
		return tags.filter(tag => {
			const tagName = tag.replace(/^#/, '').toLowerCase();
			return !this.settings.ignoredTags.some(ignored => 
				ignored.toLowerCase() === tagName
			);
		});
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

