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

	async getRelatedTags(concepts: string[], scope: ConceptScope = 'regular', tagSamples?: Map<string, string[]>, availableTags?: string[]): Promise<OpenAIResponse> {
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
							content: 'You are a tag selection assistant. You MUST ONLY return tags that appear in the provided VALID TAGS list. Any tag not in that list will be automatically rejected. Return ONLY a JSON array of tag names (without # prefix), nothing else.',
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
				// Strip markdown code blocks if present
				let jsonContent = content.trim();
				if (jsonContent.startsWith('```')) {
					// Remove opening ```json or ```
					jsonContent = jsonContent.replace(/^```(?:json)?\s*\n?/, '');
					// Remove closing ```
					jsonContent = jsonContent.replace(/\n?```\s*$/, '');
					jsonContent = jsonContent.trim();
				}
				
				// Try to parse as JSON
				const parsed = JSON.parse(jsonContent);
				console.log('[Thoughtlands:OpenAI] Parsed JSON:', parsed);
				if (Array.isArray(parsed)) {
					tags = parsed;
				} else if (typeof parsed === 'string') {
					tags = [parsed];
				}
			} catch (parseError) {
				console.log('[Thoughtlands:OpenAI] JSON parse failed, trying text extraction. Error:', parseError);
				// If not JSON, try to extract tags from text
				// Strip markdown code blocks first
				let textContent = content.trim();
				if (textContent.startsWith('```')) {
					textContent = textContent.replace(/^```(?:json)?\s*\n?/, '');
					textContent = textContent.replace(/\n?```\s*$/, '');
					textContent = textContent.trim();
				}
				tags = textContent
					.split(/[,\n]/)
					.map((t: string) => t.trim().replace(/^#/, '').replace(/[\[\]"]/g, ''))
					.filter((t: string) => t.length > 0 && !t.startsWith('```') && t !== '```')
					.slice(0, maxTags);
				console.log('[Thoughtlands:OpenAI] Extracted tags from text:', tags);
			}

			// Validate tags against availableTags list (case-insensitive)
			if (availableTags && availableTags.length > 0) {
				const availableTagsSet = new Set(availableTags.map(t => t.toLowerCase()));
				const validatedTags = tags
					.map(tag => tag.trim().replace(/^#/, ''))
					.filter(tag => {
						if (!tag) return false;
						const isValid = availableTagsSet.has(tag.toLowerCase());
						if (!isValid) {
							console.warn(`[Thoughtlands:OpenAI] AI suggested invalid tag: "${tag}" (not in vault)`);
						}
						return isValid;
					})
					.map(tagLower => {
						// Map back to original case from availableTags
						const originalTag = availableTags.find(t => t.toLowerCase() === tagLower.toLowerCase());
						return originalTag || tagLower;
					})
					.slice(0, maxTags);
				
				if (validatedTags.length < tags.length) {
					console.warn(`[Thoughtlands:OpenAI] Filtered out ${tags.length - validatedTags.length} invalid tags from AI response`);
				}
				tags = validatedTags;
			} else {
			tags = tags.slice(0, maxTags);
			}
			
			console.log('[Thoughtlands:OpenAI] Final validated tags:', tags);

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

	private buildTagSuggestionPrompt(concepts: string[], scope: ConceptScope, maxTags: number, tagSamples?: Map<string, string[]>, availableTags?: string[]): string {
		let scopeDescription = '';
		switch (scope) {
			case 'narrow':
				scopeDescription = '10-15 highly relevant tags';
				break;
			case 'regular':
				scopeDescription = '20-30 relevant tags';
				break;
			case 'broad':
				scopeDescription = '40-50 related tags';
				break;
		}

		// Start with the constraint FIRST - make it absolutely clear
		let prompt = '';
		if (availableTags && availableTags.length > 0) {
			// Include all tags - never truncate, as truncating causes AI to invent tags from missing ones
			// For very large lists, we'll include them all but format more compactly
			const tagList = availableTags.map(t => `#${t}`).join(', ');
			
			prompt += `CRITICAL CONSTRAINT: You MUST ONLY return tags from this exact list. Any tag not in this list will be rejected. Do NOT invent, create, or suggest any tags that are not in this list.\n\n`;
			prompt += `VALID TAGS ONLY (${availableTags.length} tags total):\n${tagList}\n\n`;
			const conceptText = concepts.length === 1 ? concepts[0] : concepts.join(', ');
			prompt += `Given this concept: ${conceptText}\n\n`;
			prompt += `Find and return ${scopeDescription} from the VALID TAGS list above that relate to this concept. `;
			prompt += `Be comprehensive - include tags that are directly related, indirectly related, or tangentially related to these concepts. `;
			prompt += `You MUST select tags ONLY from the list above. Every tag you return MUST appear exactly (case-insensitive) in that list. `;
		} else {
			const conceptText = concepts.length === 1 ? concepts[0] : concepts.join(', ');
			prompt = `Given this concept: ${conceptText}\n\nSuggest ${scopeDescription} that would be relevant to notes about this concept. `;
		}

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

		if (availableTags && availableTags.length > 0) {
			prompt += `\n\nFINAL REMINDER: Return ONLY tags from the VALID TAGS list above. Any tag not in that list will be automatically rejected. Return only a JSON array of tag names (without the # prefix).`;
		} else {
		prompt += `\nReturn only a JSON array of tag names (without the # prefix).`;
		}

		return prompt;
	}

	async filterTagsByRelevance(concepts: string[], tags: string[], tagSamples: Map<string, string[]>, maxTags: number, availableTags?: string[]): Promise<OpenAIResponse> {
		console.log('[Thoughtlands:OpenAI] filterTagsByRelevance called with', tags.length, 'tags, maxTags:', maxTags);
		
		if (!this.settings.openAIApiKey) {
			console.error('[Thoughtlands:OpenAI] API key not configured');
			return { success: false, error: 'OpenAI API key not configured' };
		}

		try {
			// Create availableTagsSet for validation if provided
			const availableTagsSet = availableTags && availableTags.length > 0 
				? new Set(availableTags.map(t => t.toLowerCase()))
				: null;
			
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
				const conceptText = concepts.length === 1 ? concepts[0] : concepts.join(', ');
				let prompt = `Given this concept: ${conceptText}\n\n`;
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
				prompt += `\nBased on these concepts and the sample content, select up to ${tagsFromThisBatch} relevant tags from this batch that would help find notes related to a synthesis of these concepts. `;
				prompt += `Include tags that are directly relevant, indirectly relevant, or provide useful context. `;
				prompt += `Be comprehensive rather than restrictive. Return only a JSON array of the selected tag names (without the # prefix).`;
				
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
						// Strip markdown code blocks if present
						let jsonContent = content.trim();
						if (jsonContent.startsWith('```')) {
							jsonContent = jsonContent.replace(/^```(?:json)?\s*\n?/, '');
							jsonContent = jsonContent.replace(/\n?```\s*$/, '');
							jsonContent = jsonContent.trim();
						}
						
						const parsed = JSON.parse(jsonContent);
						if (Array.isArray(parsed)) {
							batchTags = parsed;
						} else if (typeof parsed === 'string') {
							batchTags = [parsed];
						}
					} catch (parseError) {
						console.log(`[Thoughtlands:OpenAI] Batch ${i + 1} JSON parse failed, trying text extraction`);
						// Strip markdown code blocks first
						let textContent = content.trim();
						if (textContent.startsWith('```')) {
							textContent = textContent.replace(/^```(?:json)?\s*\n?/, '');
							textContent = textContent.replace(/\n?```\s*$/, '');
							textContent = textContent.trim();
						}
						batchTags = textContent
							.split(/[,\n]/)
							.map((t: string) => t.trim().replace(/^#/, '').replace(/[\[\]"]/g, ''))
							.filter((t: string) => t.length > 0 && !t.startsWith('```') && t !== '```');
					}
					
					// Validate and add tags from this batch
					for (const tag of batchTags) {
						const cleanTag = tag.trim().replace(/^#/, '');
						if (!cleanTag) continue;
						
						// If availableTagsSet is provided, validate the tag
						if (availableTagsSet) {
							if (availableTagsSet.has(cleanTag.toLowerCase())) {
								// Map back to original case
								const originalTag = availableTags!.find(t => t.toLowerCase() === cleanTag.toLowerCase());
								allFilteredTags.add(originalTag || cleanTag);
							} else {
								console.warn(`[Thoughtlands:OpenAI] Batch ${i + 1} - AI refined to invalid tag: "${cleanTag}" (not in vault)`);
							}
						} else {
							allFilteredTags.add(cleanTag);
						}
					}
					console.log(`[Thoughtlands:OpenAI] Batch ${i + 1} returned`, batchTags.length, 'tags');
				}
			}
			
			// If we have more tags than maxTags, do a final selection
			let finalTags = Array.from(allFilteredTags);
			if (finalTags.length > maxTags) {
				console.log('[Thoughtlands:OpenAI] Too many tags after batching, doing final selection');
				finalTags = await this.selectTopTags(concepts, finalTags, tagSamples, maxTags);
			}
			
			// Final validation pass if availableTags was provided
			if (availableTags && availableTags.length > 0) {
				const availableTagsSet = new Set(availableTags.map(t => t.toLowerCase()));
				const validatedTags = finalTags
					.map(tag => tag.trim().replace(/^#/, ''))
					.filter(tag => {
						if (!tag) return false;
						const isValid = availableTagsSet.has(tag.toLowerCase());
						if (!isValid) {
							console.warn(`[Thoughtlands:OpenAI] Final validation - invalid tag: "${tag}" (not in vault)`);
						}
						return isValid;
					})
					.map(tagLower => {
						// Map back to original case from availableTags
						const originalTag = availableTags.find(t => t.toLowerCase() === tagLower.toLowerCase());
						return originalTag || tagLower;
					})
					.slice(0, maxTags);
				
				if (validatedTags.length < finalTags.length) {
					console.warn(`[Thoughtlands:OpenAI] Final validation filtered out ${finalTags.length - validatedTags.length} invalid tags`);
				}
				finalTags = validatedTags;
			} else {
			finalTags = finalTags.slice(0, maxTags);
			}
			
			console.log('[Thoughtlands:OpenAI] Final validated filtered tags:', finalTags.length, 'from', tags.length, 'original tags');
			
			return { success: true, tags: finalTags };
		} catch (error) {
			console.error('[Thoughtlands:OpenAI] Exception during filter API call:', error);
			return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
		}
	}

	private async selectTopTags(concepts: string[], tags: string[], tagSamples: Map<string, string[]>, maxTags: number): Promise<string[]> {
		// Final selection call when we have too many tags
		const conceptText = concepts.length === 1 ? concepts[0] : concepts.join(', ');
		let prompt = `Given this concept: ${conceptText}\n\n`;
		prompt += `Select up to ${maxTags} relevant tags from this list: ${tags.join(', ')}. `;
		prompt += `Include tags that are directly or indirectly related to the concepts. Be comprehensive.\n\n`;
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
						{ role: 'system', content: 'You are a helpful assistant that selects relevant tags comprehensively. Include tags that are directly or indirectly related. Return only a JSON array of tag names (without # prefix), nothing else.' },
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

