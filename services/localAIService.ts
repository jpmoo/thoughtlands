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

	async getRelatedTags(
		concepts: string[],
		scope: ConceptScope,
		tagSamples?: Map<string, string[]>
	): Promise<LocalAIResponse> {
		console.log('[Thoughtlands:LocalAI] getRelatedTags called with concepts:', concepts, 'scope:', scope);

		try {
			const maxTags = this.getMaxTagsForScope(scope);
			const prompt = this.buildPrompt(concepts, scope, maxTags, tagSamples);

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
					// If we can't parse the error, use the status
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
				tags = content
					.split(/[,\n]/)
					.map((t: string) => t.trim().replace(/^#/, '').replace(/[\[\]"]/g, ''))
					.filter((t: string) => t.length > 0)
					.slice(0, maxTags);
			}

			tags = tags.slice(0, maxTags);
			console.log('[Thoughtlands:LocalAI] Final tags:', tags);

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
		maxTags: number
	): Promise<LocalAIResponse> {
		console.log('[Thoughtlands:LocalAI] filterTagsByRelevance called with', tags.length, 'tags, maxTags:', maxTags);

		try {
			const prompt = this.buildFilterPrompt(concepts, tags, tagSamples, maxTags);

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
					// If we can't parse the error, use the status
				}
				return { success: false, error: errorMessage };
			}

			const responseData = await response.json();
			// Handle both /api/chat and /api/generate response formats
			const content = responseData.message?.content?.trim() || responseData.response?.trim();

			if (!content) {
				return { success: false, error: 'No response from Ollama' };
			}

			let filteredTags: string[] = [];
			try {
				const parsed = JSON.parse(content);
				if (Array.isArray(parsed)) {
					filteredTags = parsed;
				}
			} catch (parseError) {
				filteredTags = content
					.split(/[,\n]/)
					.map((t: string) => t.trim().replace(/^#/, '').replace(/[\[\]"]/g, ''))
					.filter((t: string) => t.length > 0)
					.slice(0, maxTags);
			}

			filteredTags = filteredTags.slice(0, maxTags);
			console.log('[Thoughtlands:LocalAI] Filtered tags:', filteredTags.length, 'from', tags.length, 'original tags');

			return { success: true, tags: filteredTags };
		} catch (error) {
			console.error('[Thoughtlands:LocalAI] Exception during filter API call:', error);
			return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
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

		prompt += `\nReturn only a JSON array of tag names (without the # prefix).`;

		return prompt;
	}

	private buildFilterPrompt(
		concepts: string[],
		tags: string[],
		tagSamples: Map<string, string[]>,
		maxTags: number
	): string {
		let prompt = `Given these concepts: ${concepts.join(', ')}\n\n`;
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

		prompt += `\nBased on these concepts and the sample content, select the ${maxTags} most relevant tags that would help find notes related to a synthesis of these concepts. `;
		prompt += `Exclude tags that don't seem directly relevant. Return only a JSON array of the selected tag names (without the # prefix).`;

		return prompt;
	}

	async generateRegionName(concepts: string[], tags: string[]): Promise<{ success: boolean; name?: string; error?: string }> {
		console.log('[Thoughtlands:LocalAI] generateRegionName called with concepts:', concepts, 'tags:', tags);
		
		try {
			const prompt = `Given these concepts: ${concepts.join(', ')}

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
					// If we can't parse the error, use the status
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

