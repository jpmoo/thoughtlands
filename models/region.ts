export type RegionMode = 'search' | 'search+tags' | 'concept';

export interface RegionSource {
	type: 'search' | 'tags' | 'concept';
	query?: string;
	tags?: string[];
	concepts?: string[];
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
}

export interface RegionsData {
	regions: Region[];
}

