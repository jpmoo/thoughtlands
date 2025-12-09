import { App } from 'obsidian';
import { ThoughtlandsSettings } from '../settings/thoughtlandsSettings';
import { ConceptScope } from '../ui/conceptInputModal';

export interface LocalAIResponse {
	success: boolean;
	tags?: string[];
	error?: string;
}

export class LocalAIService {
	private app: App;
	private settings: ThoughtlandsSettings;

	constructor(app: App, settings: ThoughtlandsSettings) {
		this.app = app;
		this.settings = settings;
	}

	updateSettings(newSettings: ThoughtlandsSettings): void {
		this.settings = newSettings;
	}

	async checkOllamaAvailable(): Promise<{ available: boolean; error?: string }> {
		try {
			const response = await fetch(`${this.settings.ollamaUrl}/api/tags`, {
				method: 'GET',
				headers: {
					'Content-Type': 'application/json',
				},
			});

			if (!response.ok) {
				return {
					available: false,
					error: `Ollama not responding (HTTP ${response.status}). Is Ollama running at ${this.settings.ollamaUrl}?`
				};
			}

			// Check if the chat model is installed
			const data = await response.json();
			const models = data.models || [];
			
			// Check if chat model is installed - model names might include tags like "llama3.2:latest"
			const modelInstalled = models.some((m: any) => {
				const modelName = m.name || '';
				// Check exact match or if model name starts with our target (handles tags like :latest, :v1, etc.)
				return modelName === this.settings.ollamaChatModel || 
				       modelName.startsWith(this.settings.ollamaChatModel + ':') ||
				       modelName.startsWith(this.settings.ollamaChatModel + '@');
			});

			if (!modelInstalled) {
				return {
					available: false,
					error: `Ollama model "${this.settings.ollamaChatModel}" not installed. Please run: ollama pull ${this.settings.ollamaChatModel}`
				};
			}

			return { available: true };
		} catch (error) {
			return {
				available: false,
				error: `Cannot connect to Ollama at ${this.settings.ollamaUrl}. Is Ollama running? Error: ${error instanceof Error ? error.message : 'Unknown error'}`
			};
		}
	}

	async getRelatedTags(
		concepts: string[],
		scope: ConceptScope,
		tagSamples?: Map<string, string[]>,
		availableTags?: string[]
	): Promise<LocalAIResponse> {
		console.log('[Thoughtlands:LocalAI] getRelatedTags called with concepts:', concepts, 'scope:', scope);

		// Check if Ollama is available first
		const ollamaCheck = await this.checkOllamaAvailable();
		if (!ollamaCheck.available) {
			console.error('[Thoughtlands:LocalAI] Ollama not available:', ollamaCheck.error);
			return {
				success: false,
				error: ollamaCheck.error || 'Ollama is not available. Please check if Ollama is running.'
			};
		}

		try {
			const maxTags = this.getMaxTagsForScope(scope);
			const prompt = this.buildPrompt(concepts, scope, maxTags, tagSamples, availableTags);

			console.log('[Thoughtlands:LocalAI] Sending request to Ollama:', {
				model: this.settings.ollamaChatModel,
				scope: scope,
				maxTags: maxTags,
			});

			// Try /api/chat first (preferred for chat-like interactions), fallback to /api/generate
			let response: Response;
			
			try {
				// Try /api/chat endpoint first (Ollama's chat completion endpoint)
				response = await fetch(`${this.settings.ollamaUrl}/api/chat`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: this.settings.ollamaChatModel,
						messages: [
							{
								role: 'system',
								content: 'You are a tag selection assistant. You MUST ONLY return tags that appear in the provided list. Any tag not in the list will be automatically rejected. Return ONLY a JSON array of tag names, nothing else.',
							},
							{
								role: 'user',
								content: prompt,
							},
						],
						stream: false,
					}),
				});

				if (!response.ok) {
					// If 404, try the /api/generate endpoint as fallback
					if (response.status === 404) {
						console.log('[Thoughtlands:LocalAI] /api/chat returned 404, trying /api/generate endpoint');
						try {
						response = await fetch(`${this.settings.ollamaUrl}/api/generate`, {
							method: 'POST',
							headers: {
								'Content-Type': 'application/json',
							},
							body: JSON.stringify({
								model: this.settings.ollamaChatModel,
								prompt: prompt,
								stream: false,
							}),
						});
						} catch (fallbackError) {
							console.error('[Thoughtlands:LocalAI] Fallback fetch failed:', fallbackError);
							return { success: false, error: `Failed to connect to Ollama: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}` };
						}
					}
				}
			} catch (fetchError) {
				console.error('[Thoughtlands:LocalAI] Fetch error:', fetchError);
				return { success: false, error: `Failed to connect to Ollama: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}` };
			}

			if (!response.ok) {
				let errorMessage = `HTTP ${response.status}`;
				try {
					const error = await response.json();
					errorMessage = error.error?.message || error.message || errorMessage;
				} catch (parseError) {
					// If we can't parse the error, try to read as text
					try {
						const errorText = await response.text();
						if (errorText) {
							errorMessage = errorText;
						}
					} catch (textError) {
						// If we can't read the error, use the status
						errorMessage = `HTTP ${response.status} - Unable to read error response`;
					}
				}
				
				// Provide more helpful error messages for common issues
				if (response.status === 404) {
					errorMessage = `Ollama endpoint not found (404). The model "${this.settings.ollamaChatModel}" may not be installed. Try running: ollama pull ${this.settings.ollamaChatModel}`;
				}
				
				console.error('[Thoughtlands:LocalAI] API request failed:', { status: response.status, url: response.url, error: errorMessage });
				return { success: false, error: errorMessage };
			}

			const responseData = await response.json();
			// Handle both /api/chat and /api/generate response formats
			const content = responseData.message?.content?.trim() || responseData.response?.trim();

			if (!content) {
				console.error('[Thoughtlands:LocalAI] No content in response');
				return { success: false, error: 'No response from Ollama' };
			}

			console.log('[Thoughtlands:LocalAI] Response content:', content);

			// Parse the response to extract tags
			let tags: string[] = [];
			try {
				const parsed = JSON.parse(content);
				if (Array.isArray(parsed)) {
					tags = parsed;
				} else if (typeof parsed === 'string') {
					tags = [parsed];
				}
			} catch (parseError) {
				// Try to extract tags from text response
				console.log('[Thoughtlands:LocalAI] JSON parse failed, trying text extraction');
				tags = this.extractTagsFromText(content, maxTags);
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
							console.warn(`[Thoughtlands:LocalAI] AI suggested invalid tag: "${tag}" (not in vault)`);
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
					console.warn(`[Thoughtlands:LocalAI] Filtered out ${tags.length - validatedTags.length} invalid tags from AI response`);
			}
				tags = validatedTags;
			} else {
			tags = tags.slice(0, maxTags);
			}
			
			console.log('[Thoughtlands:LocalAI] Final validated tags:', tags);

			return {
				success: true,
				tags,
			};
		} catch (error) {
			console.error('[Thoughtlands:LocalAI] Exception during API call:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	async filterTagsByRelevance(
		concepts: string[],
		tags: string[],
		tagSamples: Map<string, string[]>,
		maxTags: number,
		availableTags?: string[]
	): Promise<LocalAIResponse> {
		console.log('[Thoughtlands:LocalAI] filterTagsByRelevance called with', tags.length, 'tags, maxTags:', maxTags);

		// Check if Ollama is available first
		const ollamaCheck = await this.checkOllamaAvailable();
		if (!ollamaCheck.available) {
			console.error('[Thoughtlands:LocalAI] Ollama not available:', ollamaCheck.error);
			return {
				success: false,
				error: ollamaCheck.error || 'Ollama is not available. Please check if Ollama is running.'
			};
		}

		try {
			const prompt = this.buildFilterPrompt(concepts, tags, tagSamples, maxTags, availableTags);

			// Try /api/chat first, fallback to /api/generate
			let response: Response;
			
			try {
				response = await fetch(`${this.settings.ollamaUrl}/api/chat`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: this.settings.ollamaChatModel,
						messages: [
							{
								role: 'system',
								content: 'You are a tag selection assistant. You MUST ONLY return tags from the candidate tags provided by the user. Do NOT invent, create, or suggest any tags that are not in the candidate list. Any tag not in that list will be automatically rejected. Return ONLY a JSON array of tag names (without # prefix), nothing else.',
							},
							{
								role: 'user',
								content: prompt,
							},
						],
						stream: false,
					}),
				});

				if (!response.ok && response.status === 404) {
					// Fallback to /api/generate
					try {
					response = await fetch(`${this.settings.ollamaUrl}/api/generate`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							model: this.settings.ollamaChatModel,
							prompt: prompt,
							stream: false,
						}),
					});
					} catch (fallbackError) {
						console.error('[Thoughtlands:LocalAI] Fallback fetch failed:', fallbackError);
						return { success: false, error: `Failed to connect to Ollama: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}` };
					}
				}
			} catch (fetchError) {
				return { success: false, error: `Failed to connect to Ollama: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}` };
			}

			if (!response.ok) {
				let errorMessage = `HTTP ${response.status}`;
				try {
					const error = await response.json();
					errorMessage = error.error?.message || error.message || errorMessage;
				} catch (parseError) {
					// If we can't parse the error, try to read as text
					try {
						const errorText = await response.text();
						if (errorText) {
							errorMessage = errorText;
						}
					} catch (textError) {
						// If we can't read the error, use the status
						errorMessage = `HTTP ${response.status} - Unable to read error response`;
					}
				}
				
				// Provide more helpful error messages for common issues
				if (response.status === 404) {
					errorMessage = `Ollama endpoint not found (404). The model "${this.settings.ollamaChatModel}" may not be installed. Try running: ollama pull ${this.settings.ollamaChatModel}`;
				}
				
				return { success: false, error: errorMessage };
			}

			const responseData = await response.json();
			// Handle both /api/chat and /api/generate response formats
			let content = responseData.message?.content?.trim() || responseData.response?.trim();

			if (!content) {
				return { success: false, error: 'No response from Ollama' };
			}

			// Strip markdown code blocks if present
			if (content.startsWith('```')) {
				content = content.replace(/^```(?:json)?\s*\n?/, '');
				content = content.replace(/\n?```\s*$/, '');
				content = content.trim();
			}

			let filteredTags: string[] = [];
			try {
				const parsed = JSON.parse(content);
				if (Array.isArray(parsed)) {
					filteredTags = parsed;
				}
			} catch (parseError) {
				// Use the improved tag extraction logic
				filteredTags = this.extractTagsFromText(content, maxTags);
			}

			// Validate tags against availableTags list (case-insensitive)
			if (availableTags && availableTags.length > 0) {
				const availableTagsSet = new Set(availableTags.map(t => t.toLowerCase()));
				const validatedTags = filteredTags
					.map(tag => tag.trim().replace(/^#/, ''))
					.filter(tag => {
						if (!tag) return false;
						const isValid = availableTagsSet.has(tag.toLowerCase());
						if (!isValid) {
							console.warn(`[Thoughtlands:LocalAI] AI refined to invalid tag: "${tag}" (not in vault)`);
						}
						return isValid;
					})
					.map(tagLower => {
						// Map back to original case from availableTags
						const originalTag = availableTags.find(t => t.toLowerCase() === tagLower.toLowerCase());
						return originalTag || tagLower;
					})
					.slice(0, maxTags);
				
				if (validatedTags.length < filteredTags.length) {
					console.warn(`[Thoughtlands:LocalAI] Filtered out ${filteredTags.length - validatedTags.length} invalid tags from AI refinement`);
			}
				filteredTags = validatedTags;
			} else {
			filteredTags = filteredTags.slice(0, maxTags);
			}
			
			console.log('[Thoughtlands:LocalAI] Final validated filtered tags:', filteredTags.length, 'from', tags.length, 'original tags');

			return { success: true, tags: filteredTags };
		} catch (error) {
			console.error('[Thoughtlands:LocalAI] Exception during filter API call:', error);
			return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
		}
	}

	private extractTagsFromText(content: string, maxTags: number): string[] {
		// Split by lines first to handle multi-line responses
		const lines = content.split(/\n/);
		const extractedTags = new Set<string>();
		
		// Keywords that indicate explanatory text (not tags)
		const explanatoryKeywords = [
			'here are', 'excluded', 'included', 'selected', 'returned',
			'most relevant', 'related to', 'synthesis of', 'can be used',
			'directly relevant', 'too narrow', 'too broad', 'subset of',
			'cover the core', 'areas of study', 'policy implications'
		];
		
		for (const line of lines) {
			// Skip empty lines
			if (!line.trim()) continue;
			
			// Check if line contains explanatory keywords (likely not a tag)
			const lowerLine = line.toLowerCase();
			if (explanatoryKeywords.some(keyword => lowerLine.includes(keyword))) {
				continue;
			}
			
			// Skip lines that are too long (likely explanatory text, not tags)
			if (line.trim().length > 50) {
				continue;
			}
			
			// Extract tag - handle various formats
			let tag = line.trim();
			
			// Remove # prefix if present
			tag = tag.replace(/^#+/, '');
			
			// Remove common prefixes like "and", "or", "the"
			tag = tag.replace(/^(and|or|the)\s+/i, '');
			
			// Remove trailing punctuation (colons, periods, commas)
			tag = tag.replace(/[:;.,!?]+$/, '');
			
			// Remove brackets and quotes
			tag = tag.replace(/[\[\]"]/g, '');
			
			// Clean up whitespace
			tag = tag.trim();
			
			// Skip if empty, too short, or looks like a sentence
			if (!tag || tag.length < 2 || tag.length > 40) {
				continue;
			}
			
			// Skip if it contains spaces and looks like a sentence (more than 3 words)
			const words = tag.split(/\s+/);
			if (words.length > 3) {
				continue;
			}
			
			// Skip if it's clearly not a tag (contains ":" in the middle, or starts with common sentence words)
			if (tag.includes(':') && !tag.startsWith('#')) {
				// Might be a tag with description, try to extract just the tag part
				const tagPart = tag.split(':')[0].trim();
				if (tagPart && tagPart.length >= 2 && tagPart.length <= 40) {
					tag = tagPart;
				} else {
					continue;
				}
			}
			
			// Add to set (automatically handles duplicates)
			if (tag) {
				extractedTags.add(tag);
			}
		}
		
		// Also try splitting by commas for comma-separated lists
		const commaParts = content.split(/,/);
		for (const part of commaParts) {
			let tag = part.trim().replace(/^#+/, '').replace(/[\[\]":;.,!?]+$/g, '').trim();
			if (tag && tag.length >= 2 && tag.length <= 40 && !explanatoryKeywords.some(k => tag.toLowerCase().includes(k))) {
				const words = tag.split(/\s+/);
				if (words.length <= 3) {
					extractedTags.add(tag);
				}
			}
		}
		
		return Array.from(extractedTags).slice(0, maxTags);
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

	private buildPrompt(concepts: string[], scope: ConceptScope, maxTags: number, tagSamples?: Map<string, string[]>, availableTags?: string[]): string {
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

		if (tagSamples && tagSamples.size > 0) {
			prompt += `\n\nTo help you understand the relationships, here are some sample excerpts from notes with various tags in the vault:\n\n`;

			let sampleCount = 0;
			const maxSamples = 10;
			for (const [tag, excerpts] of tagSamples.entries()) {
				if (sampleCount >= maxSamples) break;
				if (excerpts.length > 0) {
					const sampleExcerpts = excerpts.slice(0, 2).join(' ... ');
					prompt += `Tag #${tag}:\n"${sampleExcerpts.substring(0, 200)}..."\n\n`;
					sampleCount++;
				}
			}

			prompt += `Use these examples to understand how tags relate to content, and choose tags that would be relevant to a synthesis of the concepts provided. `;
		}

		if (availableTags && availableTags.length > 0) {
			prompt += `\n\nFINAL REMINDER: Return ONLY tags from the VALID TAGS list above. Any tag not in that list will be automatically rejected. Return ONLY a valid JSON array of tag names (without the # prefix). Do not include any explanatory text, comments, or descriptions. Example format: ["tag1", "tag2", "tag3"]`;
		} else {
			prompt += `\n\nIMPORTANT: Return ONLY a valid JSON array of tag names (without the # prefix). Do not include any explanatory text, comments, or descriptions. Example format: ["tag1", "tag2", "tag3"]`;
		}

		return prompt;
	}

	private buildFilterPrompt(
		concepts: string[],
		tags: string[],
		tagSamples: Map<string, string[]>,
		maxTags: number,
		availableTags?: string[]
	): string {
		const conceptText = concepts.length === 1 ? concepts[0] : concepts.join(', ');
		let prompt = `Given this concept: ${conceptText}\n\n`;
		prompt += `Here are ${tags.length} candidate tags with sample excerpts from notes:\n\n`;

		const maxSamplesPerTag = 3;
		const maxCharsPerExcerpt = 200;
		let includedTags: string[] = [];

		for (const tag of tags) {
			const samples = tagSamples.get(tag) || [];
			if (samples.length > 0) {
				const sampleText = samples
					.slice(0, maxSamplesPerTag)
					.map(excerpt => `"${excerpt.substring(0, maxCharsPerExcerpt)}..."`)
					.join('\n');
				prompt += `Tag #${tag}:\n${sampleText}\n\n`;
				includedTags.push(tag);
			} else {
				prompt += `Tag #${tag} (no samples available)\n\n`;
				includedTags.push(tag);
			}
		}

		prompt += `\nBased on these concepts and the sample content, select up to ${maxTags} relevant tags from the candidate tags listed above that would help find notes related to a synthesis of these concepts. `;
		prompt += `You MUST ONLY select tags from the candidate tags listed above. Do NOT invent, create, or suggest any tags that are not in that candidate list. `;
		prompt += `Include tags that are directly relevant, indirectly relevant, or provide useful context. `;
		prompt += `Be comprehensive rather than restrictive - it's better to include a tag that might be useful than to exclude it.`;
		
		// Include available tags from the vault so AI can verify tags exist
		if (availableTags && availableTags.length > 0) {
			// Filter to only show tags that are in the candidate list
			const candidateTagsSet = new Set(tags.map((t: string) => t.toLowerCase()));
			const relevantAvailableTags = availableTags.filter((t: string) => candidateTagsSet.has(t.toLowerCase()));
			
			if (relevantAvailableTags.length > 0) {
				prompt += `\n\nCRITICAL CONSTRAINT: You MUST ONLY return tags from the candidate tags listed above. Every tag you return MUST appear exactly in that candidate list. Any tag not in that list will be automatically rejected. Do NOT invent, create, or suggest any tags that are not in the candidate list.`;
			}
		}
		
		prompt += `\n\nIMPORTANT: Return ONLY a valid JSON array of the selected tag names (without the # prefix). Do not include any explanatory text, comments, or descriptions. Example format: ["tag1", "tag2", "tag3"]`;

		return prompt;
	}

	async generateRegionName(concepts: string[], tags: string[]): Promise<{ success: boolean; name?: string; error?: string }> {
		console.log('[Thoughtlands:LocalAI] generateRegionName called with concepts:', concepts, 'tags:', tags);
		
		// Check if Ollama is available first
		const ollamaCheck = await this.checkOllamaAvailable();
		if (!ollamaCheck.available) {
			console.error('[Thoughtlands:LocalAI] Ollama not available:', ollamaCheck.error);
			return {
				success: false,
				error: ollamaCheck.error || 'Ollama is not available. Please check if Ollama is running.'
			};
		}
		
		try {
			const conceptText = concepts.length === 1 ? concepts[0] : concepts.join(', ');
			const prompt = `Given this concept: ${conceptText}

And these related Obsidian tags: ${tags.slice(0, 10).join(', ')}

Generate a concise, descriptive name (2-4 words) for a region that represents notes about these concepts. Return only the name, nothing else.`;

			// Try /api/chat first, fallback to /api/generate
			let response: Response;
			
			try {
				response = await fetch(`${this.settings.ollamaUrl}/api/chat`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: this.settings.ollamaChatModel,
						messages: [
							{
								role: 'user',
								content: prompt,
							},
						],
						stream: false,
					}),
				});

				if (!response.ok && response.status === 404) {
					// Fallback to /api/generate
					try {
					response = await fetch(`${this.settings.ollamaUrl}/api/generate`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							model: this.settings.ollamaChatModel,
							prompt: prompt,
							stream: false,
						}),
					});
					} catch (fallbackError) {
						console.error('[Thoughtlands:LocalAI] Fallback fetch failed:', fallbackError);
						return { success: false, error: `Failed to connect to Ollama: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}` };
					}
				}
			} catch (fetchError) {
				return { success: false, error: `Failed to connect to Ollama: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}` };
			}

			if (!response.ok) {
				let errorMessage = `HTTP ${response.status}`;
				try {
					const error = await response.json();
					errorMessage = error.error?.message || error.message || errorMessage;
				} catch (parseError) {
					// If we can't parse the error, try to read as text
					try {
						const errorText = await response.text();
						if (errorText) {
							errorMessage = errorText;
						}
					} catch (textError) {
						// If we can't read the error, use the status
						errorMessage = `HTTP ${response.status} - Unable to read error response`;
					}
				}
				
				// Provide more helpful error messages for common issues
				if (response.status === 404) {
					errorMessage = `Ollama endpoint not found (404). The model "${this.settings.ollamaChatModel}" may not be installed. Try running: ollama pull ${this.settings.ollamaChatModel}`;
				}
				
				console.error('[Thoughtlands:LocalAI] Name generation failed:', errorMessage);
				return {
					success: false,
					error: errorMessage,
				};
			}

			const responseData = await response.json();
			// Handle both /api/chat and /api/generate response formats
			const name = responseData.message?.content?.trim() || responseData.response?.trim();
			
			if (!name) {
				return {
					success: false,
					error: 'No name generated',
				};
			}

			// Clean up the name (remove quotes, extra whitespace, etc.)
			const cleanName = name.replace(/^["']|["']$/g, '').trim();

			console.log('[Thoughtlands:LocalAI] Generated region name:', cleanName);
			return {
				success: true,
				name: cleanName,
			};
		} catch (error) {
			console.error('[Thoughtlands:LocalAI] Exception during name generation:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}

	async generateRegionNameFromConcept(conceptText: string): Promise<{ success: boolean; name?: string; error?: string }> {
		console.log('[Thoughtlands:LocalAI] generateRegionNameFromConcept called with concept:', conceptText);
		
		// Check if Ollama is available first
		const ollamaCheck = await this.checkOllamaAvailable();
		if (!ollamaCheck.available) {
			console.error('[Thoughtlands:LocalAI] Ollama not available:', ollamaCheck.error);
			return {
				success: false,
				error: ollamaCheck.error || 'Ollama is not available. Please check if Ollama is running.'
			};
		}
		
		try {
			const prompt = `Given this concept description: ${conceptText}

Generate a concise, descriptive name (2-4 words) for a region that represents notes about this concept. Return only the name, nothing else.`;

			// Try /api/chat first, fallback to /api/generate
			let response: Response;
			
			try {
				response = await fetch(`${this.settings.ollamaUrl}/api/chat`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						model: this.settings.ollamaChatModel,
						messages: [
							{
								role: 'user',
								content: prompt,
							},
						],
						stream: false,
					}),
				});

				if (!response.ok && response.status === 404) {
					// Fallback to /api/generate
					try {
					response = await fetch(`${this.settings.ollamaUrl}/api/generate`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
						body: JSON.stringify({
							model: this.settings.ollamaChatModel,
							prompt: prompt,
							stream: false,
						}),
					});
					} catch (fallbackError) {
						console.error('[Thoughtlands:LocalAI] Fallback fetch failed:', fallbackError);
						return { success: false, error: `Failed to connect to Ollama: ${fallbackError instanceof Error ? fallbackError.message : 'Unknown error'}` };
					}
				}
			} catch (fetchError) {
				return { success: false, error: `Failed to connect to Ollama: ${fetchError instanceof Error ? fetchError.message : 'Unknown error'}` };
			}

			if (!response.ok) {
				let errorMessage = `HTTP ${response.status}`;
				try {
					const error = await response.json();
					errorMessage = error.error?.message || error.message || errorMessage;
				} catch (parseError) {
					// If we can't parse the error, try to read as text
					try {
						const errorText = await response.text();
						if (errorText) {
							errorMessage = errorText;
						}
					} catch (textError) {
						// If we can't read the error, use the status
						errorMessage = `HTTP ${response.status} - Unable to read error response`;
					}
				}
				
				// Provide more helpful error messages for common issues
				if (response.status === 404) {
					errorMessage = `Ollama endpoint not found (404). The model "${this.settings.ollamaChatModel}" may not be installed. Try running: ollama pull ${this.settings.ollamaChatModel}`;
				}
				
				console.error('[Thoughtlands:LocalAI] Name generation failed:', errorMessage);
				return {
					success: false,
					error: errorMessage,
				};
			}

			const responseData = await response.json();
			// Handle both /api/chat and /api/generate response formats
			const name = responseData.message?.content?.trim() || responseData.response?.trim();
			
			if (!name) {
				return {
					success: false,
					error: 'No name generated',
				};
			}

			// Clean up the name (remove quotes, extra whitespace, etc.)
			const cleanName = name.replace(/^["']|["']$/g, '').trim();

			console.log('[Thoughtlands:LocalAI] Generated region name:', cleanName);
			return {
				success: true,
				name: cleanName,
			};
		} catch (error) {
			console.error('[Thoughtlands:LocalAI] Exception during name generation:', error);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error',
			};
		}
	}
}

