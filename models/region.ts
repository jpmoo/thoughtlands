export type RegionMode = 'search' | 'concept';

export function getModeDisplayName(mode: RegionMode, region?: Region): string {
	switch (mode) {
		case 'search':
			return 'Search';
		case 'concept':
			// Check if this is semantic similarity (has conceptText but no tag analysis)
			if (region?.source?.processingInfo?.conceptText && 
				!region.source.processingInfo.initialTags && 
				!region.source.processingInfo.refinedTags) {
				return 'Semantic Similarity';
			}
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
	// Search + AI Analysis specific fields
	searchResultsCount?: number; // Number of search results found
	searchResultsWithEmbeddings?: number; // Number of search results that had embeddings
	similarNotesFound?: number; // Number of similar notes found via embedding analysis
	// Semantic Similarity Analysis specific fields
	conceptText?: string; // The concept text used for semantic similarity analysis
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

