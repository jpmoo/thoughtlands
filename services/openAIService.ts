import { ThoughtlandsSettings } from '../settings/thoughtlandsSettings';
import { TagAffinityCache } from './tagAffinityCache';

export interface OpenAIResponse {
	success: boolean;
	tags?: string[];
	error?: string;
}

export class OpenAIService {
	private settings: ThoughtlandsSettings;
	private cache: TagAffinityCache;

	constructor(settings: ThoughtlandsSettings, cache: TagAffinityCache) {
		this.settings = settings;
		this.cache = cache;
	}

	async getRelatedTags(concepts: string[]): Promise<OpenAIResponse> {
		if (!this.settings.openAIApiKey) {
			return {
				success: false,
				error: 'OpenAI API key not configured',
			};
		}

		// Check cache first
		const cacheKey = concepts.sort().join(',');
		const cached = this.cache.get(cacheKey);
		if (cached) {
			return {
				success: true,
				tags: cached,
			};
		}

		try {
			const prompt = this.buildPrompt(concepts);
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.settings.openAIApiKey}`,
				},
				body: JSON.stringify({
					model: this.settings.aiModel,
					messages: [
						{
							role: 'system',
							content: 'You are a helpful assistant that suggests Obsidian tags based on concepts. Return only a JSON array of tag names (without # prefix), nothing else.',
						},
						{
							role: 'user',
							content: prompt,
						},
					],
					temperature: 0.7,
					max_tokens: 200,
				}),
			});

			if (!response.ok) {
				const error = await response.json();
				return {
					success: false,
					error: error.error?.message || `HTTP ${response.status}`,
				};
			}

			const data = await response.json();
			const content = data.choices[0]?.message?.content?.trim();
			
			if (!content) {
				return {
					success: false,
					error: 'No response from OpenAI',
				};
			}

			// Parse JSON array from response
			let tags: string[] = [];
			try {
				// Try to parse as JSON
				const parsed = JSON.parse(content);
				if (Array.isArray(parsed)) {
					tags = parsed;
				} else if (typeof parsed === 'string') {
					tags = [parsed];
				}
			} catch {
				// If not JSON, try to extract tags from text
				tags = content
					.split(/[,\n]/)
					.map((t: string) => t.trim().replace(/^#/, '').replace(/[\[\]"]/g, ''))
					.filter((t: string) => t.length > 0)
					.slice(0, this.settings.maxRelatedTags);
			}

			// Limit to maxRelatedTags
			tags = tags.slice(0, this.settings.maxRelatedTags);

			// Cache the result
			this.cache.set(cacheKey, tags);

			return {
				success: true,
				tags,
			};
		} catch (error) {
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	private buildPrompt(concepts: string[]): string {
		return `Given these concepts: ${concepts.join(', ')}

Suggest ${this.settings.maxRelatedTags} Obsidian tags that would be relevant to notes about these concepts. Return only a JSON array of tag names (without the # prefix).`;
	}

	updateSettings(newSettings: ThoughtlandsSettings): void {
		this.settings = newSettings;
	}
}

