export interface ThoughtlandsSettings {
	companionAppUrl: string;
	enableCompanionApp: boolean;
	connectionTimeout: number;
	openAIApiKey: string;
	ignoredTags: string[];
	ignoredPaths: string[];
	defaultColors: string[];
	maxRelatedTags: number;
	aiModel: string;
}

export const DEFAULT_SETTINGS: ThoughtlandsSettings = {
	companionAppUrl: 'http://localhost:3000',
	enableCompanionApp: true,
	connectionTimeout: 5000,
	openAIApiKey: '',
	ignoredTags: [],
	ignoredPaths: [],
	defaultColors: ['#E67E22', '#3498DB', '#9B59B6', '#1ABC9C', '#E74C3C', '#F39C12', '#34495E', '#16A085'],
	maxRelatedTags: 10,
	aiModel: 'gpt-3.5-turbo',
};

