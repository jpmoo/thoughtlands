export type RegionMode = 'search' | 'search+tags' | 'concept';

export interface RegionSource {
	type: 'search' | 'tags' | 'concept';
	query?: string;
	tags?: string[];
	concepts?: string[];
}

export interface CanvasEntry {
	path: string;
	addedAt: string;
	isNew: boolean; // true if canvas was newly created, false if added to existing
}

export interface Region {
	id: string;
	name: string;
	color: string;
	mode: RegionMode;
	source: RegionSource;
	createdAt: string;
	updatedAt: string;
	notes: string[];
	canvasPath?: string; // Deprecated: kept for backward compatibility
	canvases?: CanvasEntry[]; // Array of canvas entries with timestamps
}

export interface RegionsData {
	regions: Region[];
}

