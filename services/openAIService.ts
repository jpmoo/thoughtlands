import { ThoughtlandsSettings } from '../settings/thoughtlandsSettings';
import { TagAffinityCache } from './tagAffinityCache';
import { ConceptScope } from '../ui/conceptInputModal';

export interface OpenAIResponse {
	success: boolean;
	tags?: string[];
	error?: string;
}

export interface RegionNameResponse {
	success: boolean;
	name?: string;
	error?: string;
}

export class OpenAIService {
	private settings: ThoughtlandsSettings;
	private cache: TagAffinityCache;

	constructor(settings: ThoughtlandsSettings, cache: TagAffinityCache) {
		this.settings = settings;
		this.cache = cache;
	}

	async getRelatedTags(concepts: string[], scope: ConceptScope = 'regular', tagSamples?: Map<string, string[]>): Promise<OpenAIResponse> {
		console.log('[Thoughtlands:OpenAI] getRelatedTags called with concepts:', concepts, 'scope:', scope);
		
		if (!this.settings.openAIApiKey) {
			console.error('[Thoughtlands:OpenAI] API key not configured');
			return {
				success: false,
				error: 'OpenAI API key not configured',
			};
		}

		// Determine max tags based on scope
		const maxTags = this.getMaxTagsForScope(scope);
		
		// Check cache first (cache key includes scope)
		const cacheKey = `${concepts.sort().join(',')}:${scope}`;
		const cached = this.cache.get(cacheKey);
		if (cached) {
			console.log('[Thoughtlands:OpenAI] Using cached tags:', cached);
			return {
				success: true,
				tags: cached,
			};
		}

		try {
			const prompt = this.buildPrompt(concepts, scope, maxTags, tagSamples);
			console.log('[Thoughtlands:OpenAI] Sending request to OpenAI:', {
				model: this.settings.aiModel,
				scope: scope,
				maxTags: maxTags,
				prompt: prompt
			});
			
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
				console.error('[Thoughtlands:OpenAI] API request failed:', {
					status: response.status,
					error: error
				});
				return {
					success: false,
					error: error.error?.message || `HTTP ${response.status}`,
				};
			}

			const data = await response.json();
			const content = data.choices[0]?.message?.content?.trim();
			console.log('[Thoughtlands:OpenAI] Raw response content:', content);
			
			if (!content) {
				console.error('[Thoughtlands:OpenAI] No content in response');
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
				console.log('[Thoughtlands:OpenAI] Parsed JSON:', parsed);
				if (Array.isArray(parsed)) {
					tags = parsed;
				} else if (typeof parsed === 'string') {
					tags = [parsed];
				}
			} catch (parseError) {
				console.log('[Thoughtlands:OpenAI] JSON parse failed, trying text extraction. Error:', parseError);
				// If not JSON, try to extract tags from text
				tags = content
					.split(/[,\n]/)
					.map((t: string) => t.trim().replace(/^#/, '').replace(/[\[\]"]/g, ''))
					.filter((t: string) => t.length > 0)
					.slice(0, maxTags);
				console.log('[Thoughtlands:OpenAI] Extracted tags from text:', tags);
			}

			// Limit to maxTags for scope
			tags = tags.slice(0, maxTags);
			console.log('[Thoughtlands:OpenAI] Final tags after limiting:', tags);

			// Cache the result
			this.cache.set(cacheKey, tags);

			return {
				success: true,
				tags,
			};
		} catch (error) {
			console.error('[Thoughtlands:OpenAI] Exception during API call:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	private getMaxTagsForScope(scope: ConceptScope): number {
		switch (scope) {
			case 'narrow':
				return 10;
			case 'regular':
				return 30;
			case 'broad':
				return 50;
			default:
				return 30;
		}
	}

	private buildPrompt(concepts: string[], scope: ConceptScope, maxTags: number, tagSamples?: Map<string, string[]>): string {
		return this.buildTagSuggestionPrompt(concepts, scope, maxTags, tagSamples);
	}

	private buildTagSuggestionPrompt(concepts: string[], scope: ConceptScope, maxTags: number, tagSamples?: Map<string, string[]>): string {
		let scopeDescription = '';
		switch (scope) {
			case 'narrow':
				scopeDescription = 'the top tags, up to 10';
				break;
			case 'regular':
				scopeDescription = 'the top tags, up to 30';
				break;
			case 'broad':
				scopeDescription = 'up to 50 related tags';
				break;
		}

		let prompt = `Given these concepts: ${concepts.join(', ')}

Suggest ${scopeDescription} that would be relevant to notes about these concepts. `;

		// Add tag samples if provided to help AI understand relationships
		if (tagSamples && tagSamples.size > 0) {
			prompt += `\n\nTo help you understand the relationships, here are some sample excerpts from notes with various tags in the vault:\n\n`;
			
			let sampleCount = 0;
			const maxSamples = 10; // Limit samples to avoid token limits
			for (const [tag, excerpts] of tagSamples.entries()) {
				if (sampleCount >= maxSamples) break;
				if (excerpts.length > 0) {
					const sampleExcerpts = excerpts.slice(0, 2).join(' ... '); // Take first 2 excerpts per tag
					prompt += `Tag #${tag}:\n"${sampleExcerpts.substring(0, 200)}..."\n\n`; // Limit excerpt length
					sampleCount++;
				}
			}
			
			prompt += `Use these examples to understand how tags relate to content, and choose tags that would be relevant to a synthesis of the concepts provided. `;
		}

		prompt += `\nReturn only a JSON array of tag names (without the # prefix).`;

		return prompt;
	}

	async filterTagsByRelevance(concepts: string[], tags: string[], tagSamples: Map<string, string[]>, maxTags: number): Promise<OpenAIResponse> {
		console.log('[Thoughtlands:OpenAI] filterTagsByRelevance called with', tags.length, 'tags, maxTags:', maxTags);
		
		if (!this.settings.openAIApiKey) {
			console.error('[Thoughtlands:OpenAI] API key not configured');
			return { success: false, error: 'OpenAI API key not configured' };
		}

		try {
			// Batch tags to ensure all are covered
			const maxSamplesPerTag = 3;
			const maxCharsPerExcerpt = 200;
			const maxCharsPerBatch = 2500; // Conservative limit per batch
			const tagsPerBatch = 15; // Approximate tags per batch
			
			// Create batches of tags
			const batches: string[][] = [];
			let currentBatch: string[] = [];
			let currentBatchChars = 0;
			
			for (const tag of tags) {
				const samples = tagSamples.get(tag) || [];
				let tagChars = `Tag #${tag}:\n`.length;
				
				if (samples.length > 0) {
					const sampleText = samples
						.slice(0, maxSamplesPerTag)
						.map(excerpt => `"${excerpt.substring(0, maxCharsPerExcerpt)}..."`)
						.join('\n');
					tagChars += sampleText.length + 2; // +2 for newlines
				} else {
					tagChars += `(no samples available)\n`.length;
				}
				
				// Start new batch if this tag would exceed limits
				if (currentBatch.length >= tagsPerBatch || (currentBatchChars + tagChars > maxCharsPerBatch && currentBatch.length > 0)) {
					batches.push(currentBatch);
					currentBatch = [tag];
					currentBatchChars = tagChars;
				} else {
					currentBatch.push(tag);
					currentBatchChars += tagChars;
				}
			}
			
			// Add final batch
			if (currentBatch.length > 0) {
				batches.push(currentBatch);
			}
			
			console.log('[Thoughtlands:OpenAI] Created', batches.length, 'batches for filtering');
			
			// Process each batch
			const allFilteredTags = new Set<string>();
			
			for (let i = 0; i < batches.length; i++) {
				const batch = batches[i];
				console.log(`[Thoughtlands:OpenAI] Processing batch ${i + 1}/${batches.length} with ${batch.length} tags`);
				
				// Build prompt for this batch
				let prompt = `Given these concepts: ${concepts.join(', ')}\n\n`;
				prompt += `Here are ${batch.length} candidate tags (batch ${i + 1} of ${batches.length}) with sample excerpts from notes:\n\n`;
				
				for (const tag of batch) {
					const samples = tagSamples.get(tag) || [];
					prompt += `Tag #${tag}:\n`;
					
					if (samples.length > 0) {
						const sampleText = samples
							.slice(0, maxSamplesPerTag)
							.map(excerpt => `"${excerpt.substring(0, maxCharsPerExcerpt)}..."`)
							.join('\n');
						prompt += sampleText + '\n\n';
					} else {
						prompt += `(no samples available)\n\n`;
					}
				}
				
				// Calculate how many tags to select from this batch
				// Distribute maxTags across batches proportionally
				const tagsFromThisBatch = Math.ceil((batch.length / tags.length) * maxTags);
				prompt += `\nBased on these concepts and the sample content, select up to ${tagsFromThisBatch} most relevant tags from this batch that would help find notes related to a synthesis of these concepts. `;
				prompt += `Exclude tags that don't seem directly relevant. Return only a JSON array of the selected tag names (without the # prefix).`;
				
				console.log(`[Thoughtlands:OpenAI] Batch ${i + 1} prompt length:`, prompt.length, 'characters');
				
				const response = await fetch('https://api.openai.com/v1/chat/completions', {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${this.settings.openAIApiKey}`,
					},
					body: JSON.stringify({
						model: this.settings.aiModel,
						messages: [
							{ role: 'system', content: 'You are a helpful assistant that filters tags based on relevance to concepts. Return only a JSON array of tag names (without # prefix), nothing else.' },
							{ role: 'user', content: prompt },
						],
						temperature: 0.7,
						max_tokens: Math.min(tagsFromThisBatch * 20, 500),
					}),
				});

				if (!response.ok) {
					const error = await response.json();
					console.error(`[Thoughtlands:OpenAI] Batch ${i + 1} API request failed:`, { status: response.status, error: error });
					// Continue with other batches even if one fails
					continue;
				}

				const data = await response.json();
				const content = data.choices[0]?.message?.content?.trim();

				if (content) {
					let batchTags: string[] = [];
					try {
						const parsed = JSON.parse(content);
						if (Array.isArray(parsed)) {
							batchTags = parsed;
						} else if (typeof parsed === 'string') {
							batchTags = [parsed];
						}
					} catch (parseError) {
						console.log(`[Thoughtlands:OpenAI] Batch ${i + 1} JSON parse failed, trying text extraction`);
						batchTags = content
							.split(/[,\n]/)
							.map((t: string) => t.trim().replace(/^#/, '').replace(/[\[\]"]/g, ''))
							.filter((t: string) => t.length > 0);
					}
					
					batchTags.forEach(tag => allFilteredTags.add(tag));
					console.log(`[Thoughtlands:OpenAI] Batch ${i + 1} returned`, batchTags.length, 'tags');
				}
			}
			
			// If we have more tags than maxTags, do a final selection
			let finalTags = Array.from(allFilteredTags);
			if (finalTags.length > maxTags) {
				console.log('[Thoughtlands:OpenAI] Too many tags after batching, doing final selection');
				finalTags = await this.selectTopTags(concepts, finalTags, tagSamples, maxTags);
			}
			
			finalTags = finalTags.slice(0, maxTags);
			console.log('[Thoughtlands:OpenAI] Final filtered tags:', finalTags.length, 'from', tags.length, 'original tags');
			
			return { success: true, tags: finalTags };
		} catch (error) {
			console.error('[Thoughtlands:OpenAI] Exception during filter API call:', error);
			return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
		}
	}

	private async selectTopTags(concepts: string[], tags: string[], tagSamples: Map<string, string[]>, maxTags: number): Promise<string[]> {
		// Final selection call when we have too many tags
		let prompt = `Given these concepts: ${concepts.join(', ')}\n\n`;
		prompt += `Select the ${maxTags} most relevant tags from this list: ${tags.join(', ')}\n\n`;
		prompt += `Return only a JSON array of the ${maxTags} most relevant tag names (without the # prefix).`;
		
		try {
			const response = await fetch('https://api.openai.com/v1/chat/completions', {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'Authorization': `Bearer ${this.settings.openAIApiKey}`,
				},
				body: JSON.stringify({
					model: this.settings.aiModel,
					messages: [
						{ role: 'system', content: 'You are a helpful assistant that selects the most relevant tags. Return only a JSON array of tag names (without # prefix), nothing else.' },
						{ role: 'user', content: prompt },
					],
					temperature: 0.7,
					max_tokens: Math.min(maxTags * 20, 500),
				}),
			});

			if (!response.ok) {
				console.error('[Thoughtlands:OpenAI] Final selection API request failed');
				return tags.slice(0, maxTags); // Fallback to first N tags
			}

			const data = await response.json();
			const content = data.choices[0]?.message?.content?.trim();

			if (content) {
				try {
					const parsed = JSON.parse(content);
					if (Array.isArray(parsed)) {
						return parsed;
					}
				} catch (parseError) {
					// Fall through to text extraction
				}
				
				return content
					.split(/[,\n]/)
					.map((t: string) => t.trim().replace(/^#/, '').replace(/[\[\]"]/g, ''))
					.filter((t: string) => t.length > 0)
					.slice(0, maxTags);
			}
		} catch (error) {
			console.error('[Thoughtlands:OpenAI] Exception during final selection:', error);
		}
		
		return tags.slice(0, maxTags); // Fallback
	}

	async generateRegionName(concepts: string[], tags: string[]): Promise<RegionNameResponse> {
		console.log('[Thoughtlands:OpenAI] generateRegionName called with concepts:', concepts, 'tags:', tags);
		
		if (!this.settings.openAIApiKey) {
			return {
				success: false,
				error: 'OpenAI API key not configured',
			};
		}

		try {
			const prompt = `Given these concepts: ${concepts.join(', ')}

And these related Obsidian tags: ${tags.slice(0, 10).join(', ')}

Generate a concise, descriptive name (2-4 words) for a region that represents notes about these concepts. Return only the name, nothing else.`;

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
							content: 'You are a helpful assistant that generates concise, descriptive names for collections of related notes. Return only the name, nothing else.',
						},
						{
							role: 'user',
							content: prompt,
						},
					],
					temperature: 0.7,
					max_tokens: 50,
				}),
			});

			if (!response.ok) {
				const error = await response.json();
				console.error('[Thoughtlands:OpenAI] Name generation failed:', error);
				return {
					success: false,
					error: error.error?.message || `HTTP ${response.status}`,
				};
			}

			const data = await response.json();
			const name = data.choices[0]?.message?.content?.trim();
			
			if (!name) {
				return {
					success: false,
					error: 'No name generated',
				};
			}

			// Clean up the name (remove quotes, extra whitespace, etc.)
			const cleanName = name.replace(/^["']|["']$/g, '').trim();

			console.log('[Thoughtlands:OpenAI] Generated region name:', cleanName);
			return {
				success: true,
				name: cleanName,
			};
		} catch (error) {
			console.error('[Thoughtlands:OpenAI] Exception during name generation:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	updateSettings(newSettings: ThoughtlandsSettings): void {
		this.settings = newSettings;
	}
}

