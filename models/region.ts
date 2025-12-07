export type RegionMode = 'search' | 'search+tags' | 'concept';

export function getModeDisplayName(mode: RegionMode, region?: Region): string {
	switch (mode) {
		case 'search':
			return 'Search';
		case 'search+tags':
			return 'Search + Tags';
		case 'concept':
			// Show which AI was used if available
			if (region?.source?.aiMode) {
				const aiProvider = region.source.aiMode === 'local' ? 'Local' : 'ChatGPT';
				return `AI-assisted (${aiProvider})`;
			}
			return 'AI-assisted';
		default:
			return mode;
	}
}

export interface ConceptProcessingInfo {
	initialTags?: string[]; // Tags from first AI prompt (validated)
	refinedTags?: string[]; // Tags after second pass with note excerpts (validated)
	initialTagsCount?: number; // Count of validated initial tags
	refinedTagsCount?: number; // Count of validated refined tags
	finalTagsCount?: number; // Final count after ignore filtering
	notesBeforeEmbedding?: number;
	embeddingRemovedCount?: number;
	embeddingAddedCount?: number;
	embeddingFiltered?: boolean;
	similarityThreshold?: number; // Similarity threshold used for filtering
}

export interface RegionSource {
	type: 'search' | 'tags' | 'concept';
	query?: string;
	tags?: string[];
	concepts?: string[];
	aiMode?: 'local' | 'openai'; // Which AI was used for concept regions
	processingInfo?: ConceptProcessingInfo; // Processing narrative for concept regions
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

