import { App, TFile, Plugin } from 'obsidian';
import { Region } from '../models/region';
import { EmbeddingService } from './embeddingService';
import { LocalAIService } from './localAIService';
import { ThoughtlandsSettings } from '../settings/thoughtlandsSettings';

// Canvas data structures
interface CanvasNode {
	id: string;
	type: string;
	x: number;
	y: number;
	width: number;
	height: number;
	text?: string;
	file?: string;
	styleAttributes?: {};
	[key: string]: any;
}

interface CanvasEdge {
	id: string;
	fromNode: string;
	fromSide: string;
	toNode: string;
	toSide: string;
	color?: string;
	styleAttributes?: {};
	[key: string]: any;
}

interface CanvasData {
	nodes: CanvasNode[];
	edges: CanvasEdge[];
	metadata?: {
		version: string;
	};
	[key: string]: any;
}

export class CanvasService {
	private app: App;
	private embeddingService?: EmbeddingService;
	private localAIService?: LocalAIService;
	private settings?: ThoughtlandsSettings;
	private plugin?: Plugin;

	constructor(app: App, embeddingService?: EmbeddingService, localAIService?: LocalAIService, settings?: ThoughtlandsSettings, plugin?: Plugin) {
		this.app = app;
		this.embeddingService = embeddingService;
		this.localAIService = localAIService;
		this.settings = settings;
		this.plugin = plugin;
	}

	async addRegionToCanvas(canvasFile: TFile, region: Region, isNewCanvas: boolean = false, drawConnections: boolean = false, card?: { text: string; color: string; clustering?: number; crowdLayout?: 'regiment' | 'gaggle' }, arrangeBySimilarity: boolean = false, clustering?: number): Promise<{ path: string; isNew: boolean } | null> {
		try {
			// Update status: starting
			if (this.plugin && (this.plugin as any).updateRegionCreationStatus) {
				(this.plugin as any).updateRegionCreationStatus({
					isCreating: true,
					step: 'Generating canvas...',
					details: `Processing ${region.name}`
				});
			}
			
			console.log('[Thoughtlands:CanvasService] Adding region to canvas:', region.name, canvasFile.path);
			console.log('[Thoughtlands:CanvasService] Layout parameter - clustering:', clustering);
			
			// Read the canvas file
			const canvasData = await this.app.vault.read(canvasFile);
			let canvas: CanvasData;

			try {
				canvas = JSON.parse(canvasData);
				console.log('[Thoughtlands:CanvasService] Loaded existing canvas with', canvas.nodes?.length || 0, 'nodes and', canvas.edges?.length || 0, 'edges');
				// Log an example node structure if nodes exist
				if (canvas.nodes && canvas.nodes.length > 0) {
					console.log('[Thoughtlands:CanvasService] Example existing node:', JSON.stringify(canvas.nodes[0], null, 2));
				}
				// Log an example edge structure if edges exist
				if (canvas.edges && canvas.edges.length > 0) {
					console.log('[Thoughtlands:CanvasService] Example existing edge:', JSON.stringify(canvas.edges[0], null, 2));
					console.log('[Thoughtlands:CanvasService] All existing edge IDs:', canvas.edges.map((e: any) => e.id));
				}
			} catch (error) {
				console.log('[Thoughtlands:CanvasService] Failed to parse canvas, creating new structure');
				// If parsing fails, create a new canvas structure
				canvas = {
					nodes: [],
					edges: [],
				};
			}

			// Ensure nodes and edges arrays exist
			if (!canvas.nodes) canvas.nodes = [];
			if (!canvas.edges) canvas.edges = [];
			
			// Store count of existing edges before we add new ones
			const existingEdgesBefore = canvas.edges.length;
			
			// Ensure metadata exists (Obsidian canvas files have this)
			if (!canvas.metadata) {
				canvas.metadata = {
					version: '1.0-1.0'
				};
			}

			// Get existing node positions to avoid overlaps
			const existingNodes = canvas.nodes || [];
			const maxX = existingNodes.length > 0 
				? Math.max(...existingNodes.map((n: any) => n.x || 0)) 
				: 0;
			const maxY = existingNodes.length > 0 
				? Math.max(...existingNodes.map((n: any) => n.y || 0)) 
				: 0;

			// Starting position for new nodes
			// If no existing nodes, start at origin; otherwise place to the right
			// Ensure nodes start at a reasonable position (not too far from origin)
			let centerX = existingNodes.length > 0 ? maxX + 600 : 500;
			let centerY = existingNodes.length > 0 ? maxY + 400 : 400;
			const nodeWidth = 280; // Smaller width to fit more per row
			const nodeHeight = 200;
			const spacing = 25; // Reduced spacing to fit more per row

			// Track added nodes for edge creation
			let addedNodes: CanvasNode[] = [];
			
			// Handle semantic similarity arrangement
			if (arrangeBySimilarity && this.embeddingService) {
				console.log('[Thoughtlands:CanvasService] Arranging by semantic similarity');
				console.log(`[Thoughtlands:CanvasService] region.notes.length: ${region.notes.length}`);
				
				// Get the semantic similarity mode from region (default to walkabout)
				const semanticMode = region.source.processingInfo?.semanticSimilarityMode || 'walkabout';
				console.log(`[Thoughtlands:CanvasService] Semantic similarity mode: ${semanticMode}`);
				
				// Update status: calculating similarities
				if (this.plugin && (this.plugin as any).updateRegionCreationStatus) {
					(this.plugin as any).updateRegionCreationStatus({
						isCreating: true,
						step: 'Calculating semantic similarities...',
						details: `Analyzing ${region.notes.length} notes`
					});
				}
				
				// Get center embedding (from card text or generate from region name/concept)
				let centerEmbedding: number[] | null = null;
				let centerText = '';
				
				if (card) {
					// Use card text as center
					centerText = card.text;
					try {
						centerEmbedding = await this.embeddingService.generateEmbedding(card.text);
						console.log(`[Thoughtlands:CanvasService] Generated center embedding from card text, length: ${centerEmbedding?.length || 0}`);
					} catch (error) {
						console.warn('[Thoughtlands:CanvasService] Failed to generate embedding for card text:', error);
					}
				} else {
					// Generate center from region name or concept
					if (region.source.query) {
						centerText = region.source.query;
					} else if (region.source.concepts && region.source.concepts.length > 0) {
						centerText = region.source.concepts.join(', ');
					} else if (region.source.processingInfo?.conceptText) {
						centerText = region.source.processingInfo.conceptText;
					} else {
						centerText = region.name;
					}
					
					try {
						centerEmbedding = await this.embeddingService.generateEmbedding(centerText);
						console.log(`[Thoughtlands:CanvasService] Generated center embedding from "${centerText}", length: ${centerEmbedding?.length || 0}`);
					} catch (error) {
						console.warn('[Thoughtlands:CanvasService] Failed to generate embedding for center:', error);
					}
				}
				
				// If we have a center embedding, arrange notes based on mode
				if (centerEmbedding) {
					console.log(`[Thoughtlands:CanvasService] Center embedding exists, processing ${region.notes.length} region notes`);
					// Calculate similarity scores for all notes
					const noteSimilarities: { notePath: string; similarity: number; file: TFile }[] = [];
					
					for (const notePath of region.notes) {
						const noteFile = this.app.vault.getAbstractFileByPath(notePath);
						if (!(noteFile instanceof TFile)) {
							console.warn(`[Thoughtlands:CanvasService] Note file not found: ${notePath}`);
							continue;
						}
						
						try {
							// Get embedding for this note
							const storageService = this.embeddingService.getStorageService();
							const hasEmbedding = await storageService.hasEmbedding(noteFile);
							
							if (hasEmbedding) {
								const noteEmbedding = await storageService.getEmbedding(noteFile);
								if (noteEmbedding) {
									const similarity = this.embeddingService.cosineSimilarity(centerEmbedding, noteEmbedding);
									noteSimilarities.push({ notePath, similarity, file: noteFile });
								} else {
									console.warn(`[Thoughtlands:CanvasService] No embedding data for note: ${notePath}`);
								}
							} else {
								console.warn(`[Thoughtlands:CanvasService] Note has no embedding: ${notePath}`);
							}
						} catch (error) {
							console.warn('[Thoughtlands:CanvasService] Failed to get embedding for note:', notePath, error);
						}
					}
					
					// Sort by similarity (highest first)
					noteSimilarities.sort((a, b) => b.similarity - a.similarity);
					
					console.log(`[Thoughtlands:CanvasService] Found ${noteSimilarities.length} notes with embeddings for similarity arrangement`);
					
					// Arrange based on mode
					console.log(`[Thoughtlands:CanvasService] Arranging with mode: ${semanticMode}, noteSimilarities.length: ${noteSimilarities.length}`);
					if (semanticMode === 'crowd') {
						// Crowd: Same semantic similarity filtering as walkabout, but arranged in a grid or gaggle
						const crowdLayout = card?.crowdLayout || 'regiment';
						console.log(`[Thoughtlands:CanvasService] Crowd mode: Using ${noteSimilarities.length} notes from semantic similarity, layout: ${crowdLayout}`);
						console.log(`[Thoughtlands:CanvasService] Crowd mode: card=${JSON.stringify(card)}, card.crowdLayout=${card?.crowdLayout}, final crowdLayout=${crowdLayout}`);
						console.log(`[Thoughtlands:CanvasService] Crowd mode: region.notes.length=${region.notes.length}, noteSimilarities.length=${noteSimilarities.length}`);
						// Place center card if provided (raised a bit)
						const cardWidth = 400;
						const cardHeight = 150;
						const cardRaiseOffset = 50; // Raise the card by 50 pixels
						
						if (card) {
							const cardNodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
							
							let canvasColor = card.color;
							if (canvasColor && !canvasColor.match(/^[1-6]$/) && !canvasColor.startsWith('#')) {
								canvasColor = '#' + canvasColor.replace(/^#/, '');
							}
							
							const cardNode: CanvasNode = {
								id: cardNodeId,
								type: 'text',
								text: card.text,
								x: Math.round(centerX - cardWidth / 2),
								y: Math.round(centerY - cardHeight / 2 - cardRaiseOffset),
								width: cardWidth,
								height: cardHeight,
								color: canvasColor
							};
							
							canvas.nodes.push(cardNode);
						} else if (centerText) {
							const cardNodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
							
							const cardNode: CanvasNode = {
								id: cardNodeId,
								type: 'text',
								text: centerText,
								x: Math.round(centerX - cardWidth / 2),
								y: Math.round(centerY - cardHeight / 2 - cardRaiseOffset),
								width: cardWidth,
								height: cardHeight,
								color: '1'
							};
							
							canvas.nodes.push(cardNode);
						}
						
						if (crowdLayout === 'regiment') {
							// Place all notes in a strict grid layout
							// Start notes below the card with proper spacing
							const gridStartX = centerX;
							const gridStartY = centerY + 200; // Start below the card
							const gridSpacingX = nodeWidth + 50;
							const gridSpacingY = nodeHeight + 50;
							const notesPerRow = Math.floor(Math.sqrt(noteSimilarities.length)) || 1;
							
							for (let i = 0; i < noteSimilarities.length; i++) {
								const note = noteSimilarities[i];
								const row = Math.floor(i / notesPerRow);
								const col = i % notesPerRow;
								
								const nodeX = gridStartX + col * gridSpacingX;
								const nodeY = gridStartY + row * gridSpacingY;
								
								const nodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
								
								const noteNode: CanvasNode = {
									id: nodeId,
									type: 'file',
									file: note.notePath,
									x: Math.round(nodeX - nodeWidth / 2),
									y: Math.round(nodeY - nodeHeight / 2),
									width: nodeWidth,
									height: nodeHeight,
									styleAttributes: {},
								};
								
								canvas.nodes.push(noteNode);
								addedNodes.push(noteNode);
							}
						} else {
							// Gaggle: Compact crowd - loosely jumbled but not overlapping, in a roughly circular area
							// Method: Pure random placement with heavy Gaussian noise - maximum chaos, no patterns
							console.log(`[Thoughtlands:CanvasService] Gaggle layout: Processing ${noteSimilarities.length} notes`);
							console.log(`[Thoughtlands:CanvasService] Gaggle layout: crowdLayout=${card?.crowdLayout}, card=${JSON.stringify(card)}`);
							
							const minSpacing = Math.max(nodeWidth, nodeHeight) + 20; // Spacing to prevent overlap
							// Calculate compact circular radius - make it larger for organic spread
							const noteArea = noteSimilarities.length * minSpacing * minSpacing;
							const compactRadius = Math.max(600, Math.sqrt(noteArea / Math.PI) * 1.8); // Larger radius
							
							// Helper function to generate Gaussian (normal) random number using Box-Muller transform
							const gaussianRandom = (mean: number = 0, stdDev: number = 1): number => {
								const u1 = Math.random();
								const u2 = Math.random();
								// Avoid log(0) by ensuring u1 > 0
								const z0 = Math.sqrt(-2 * Math.log(Math.max(u1, 1e-10))) * Math.cos(2 * Math.PI * u2);
								return z0 * stdDev + mean;
							};
							
							const placedPositions: { x: number; y: number }[] = [];
							
							// Place all notes using pure random with heavy Gaussian noise - no patterns, maximum chaos
							for (let i = 0; i < noteSimilarities.length; i++) {
								const note = noteSimilarities[i];
								let nodeX = centerX;
								let nodeY = centerY + 200;
								let validPosition = false;
								let attempts = 0;
								const maxAttempts = 2000; // Many attempts for organic placement
								
								while (!validPosition && attempts < maxAttempts) {
									// Pure random placement in circle - no clustering, no patterns
									const angle = Math.random() * 2 * Math.PI;
									// Use square root of random for uniform distribution in circle
									const radius = Math.sqrt(Math.random()) * compactRadius;
									
									// Base position
									nodeX = centerX + radius * Math.cos(angle);
									nodeY = centerY + 200 + radius * Math.sin(angle);
									
									// Apply HEAVY Gaussian noise to break any grid pattern
									// Use large standard deviation relative to spacing for maximum chaos
									const noiseStdDev = minSpacing * 0.8; // Very large noise (80% of spacing)
									nodeX += gaussianRandom(0, noiseStdDev);
									nodeY += gaussianRandom(0, noiseStdDev);
									
									// Add additional random jitter for extra chaos
									nodeX += (Math.random() - 0.5) * minSpacing * 0.3;
									nodeY += (Math.random() - 0.5) * minSpacing * 0.3;
									
									// Check if within circle bounds (with tolerance)
									const dxFromCenter = nodeX - centerX;
									const dyFromCenter = nodeY - (centerY + 200);
									const distFromCenter = Math.sqrt(dxFromCenter * dxFromCenter + dyFromCenter * dyFromCenter);
									
									if (distFromCenter > compactRadius * 1.2) {
										attempts++;
										continue; // Outside circle, try again
									}
									
									// Check for overlap with existing positions
									validPosition = true;
									for (const placed of placedPositions) {
										const dx = nodeX - placed.x;
										const dy = nodeY - placed.y;
										const dist = Math.sqrt(dx * dx + dy * dy);
										if (dist < minSpacing) {
											validPosition = false;
											break;
										}
									}
									attempts++;
								}
								
								// If still no position, expand circle and try with even more noise
								if (!validPosition) {
									const expandedRadius = compactRadius * 1.5;
									for (let finalAttempt = 0; finalAttempt < 500; finalAttempt++) {
										const angle = Math.random() * 2 * Math.PI;
										const radius = Math.sqrt(Math.random()) * expandedRadius;
										nodeX = centerX + radius * Math.cos(angle);
										nodeY = centerY + 200 + radius * Math.sin(angle);
										
										// Maximum chaos - very large noise
										const noiseStdDev = minSpacing * 1.0; // 100% of spacing
										nodeX += gaussianRandom(0, noiseStdDev);
										nodeY += gaussianRandom(0, noiseStdDev);
										nodeX += (Math.random() - 0.5) * minSpacing * 0.4;
										nodeY += (Math.random() - 0.5) * minSpacing * 0.4;
										
										// Check bounds
										const dxFromCenter = nodeX - centerX;
										const dyFromCenter = nodeY - (centerY + 200);
										const distFromCenter = Math.sqrt(dxFromCenter * dxFromCenter + dyFromCenter * dyFromCenter);
										
										if (distFromCenter > expandedRadius * 1.2) {
											continue;
										}
										
										// Check overlap
										validPosition = true;
										for (const placed of placedPositions) {
											const dx = nodeX - placed.x;
											const dy = nodeY - placed.y;
											const dist = Math.sqrt(dx * dx + dy * dy);
											if (dist < minSpacing) {
												validPosition = false;
												break;
											}
										}
										if (validPosition) break;
									}
								}
								
								placedPositions.push({ x: nodeX, y: nodeY });
								
								// Render note - DO NOT round to avoid snap-to-grid, use precise positions
								const nodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
								
								const noteNode: CanvasNode = {
									id: nodeId,
									type: 'file',
									file: note.notePath,
									// Use precise positions (no rounding) to avoid snap-to-grid
									x: nodeX - nodeWidth / 2,
									y: nodeY - nodeHeight / 2,
									width: nodeWidth,
									height: nodeHeight,
									styleAttributes: {},
								};
								
								canvas.nodes.push(noteNode);
								addedNodes.push(noteNode);
							}
							
							console.log(`[Thoughtlands:CanvasService] Gaggle layout: Placed ${addedNodes.length} notes in organic circular crowd`);
						}
					} else if (semanticMode === 'hopscotch' || semanticMode === 'rolling-path') {
						// Path-based arrangement: left to right
						// Place center card up and to the left of the first note
						const cardWidth = 400;
						const cardHeight = 150;
						const minSpacing = 100; // Minimum spacing between card and first note, and between notes
						const horizontalSpacing = nodeWidth + minSpacing;
						const verticalSpacing = nodeHeight + minSpacing;
						
						// Calculate starting position for first note
						const firstNoteStartX = centerX + minSpacing;
						const firstNoteStartY = centerY;
						
						// Place card up and to the left of the first note
						const cardX = firstNoteStartX - cardWidth - minSpacing;
						const cardY = firstNoteStartY - cardHeight - minSpacing;
						
						if (card) {
							const cardNodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
							
							let canvasColor = card.color;
							if (canvasColor && !canvasColor.match(/^[1-6]$/) && !canvasColor.startsWith('#')) {
								canvasColor = '#' + canvasColor.replace(/^#/, '');
							}
							
							const cardNode: CanvasNode = {
								id: cardNodeId,
								type: 'text',
								text: card.text,
								x: Math.round(cardX),
								y: Math.round(cardY),
								width: cardWidth,
								height: cardHeight,
								color: canvasColor
							};
							
							canvas.nodes.push(cardNode);
						} else if (centerText) {
							const cardNodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
							
							const cardNode: CanvasNode = {
								id: cardNodeId,
								type: 'text',
								text: centerText,
								x: Math.round(cardX),
								y: Math.round(cardY),
								width: cardWidth,
								height: cardHeight,
								color: '1'
							};
							
							canvas.nodes.push(cardNode);
						}
						
						for (let i = 0; i < noteSimilarities.length; i++) {
							const note = noteSimilarities[i];
							// Notes step diagonally down and to the right
							const nodeX = firstNoteStartX + i * horizontalSpacing;
							const nodeY = firstNoteStartY + i * verticalSpacing;
							
							const nodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
							
							const noteNode: CanvasNode = {
								id: nodeId,
								type: 'file',
								file: note.notePath,
								x: Math.round(nodeX - nodeWidth / 2),
								y: Math.round(nodeY - nodeHeight / 2),
								width: nodeWidth,
								height: nodeHeight,
								styleAttributes: {},
							};
							
							canvas.nodes.push(noteNode);
							addedNodes.push(noteNode);
						}
						
						// Add summary card at the end of the path
						if (noteSimilarities.length > 0 && this.localAIService && this.settings && this.settings.aiMode === 'local') {
							// Update status: generating path summary
							if (this.plugin && (this.plugin as any).updateRegionCreationStatus) {
								(this.plugin as any).updateRegionCreationStatus({
									isCreating: true,
									step: 'Generating path summary...',
									details: 'Creating summary card for the path'
								});
							}
							
							// Calculate position after the last note
							const lastNoteIndex = noteSimilarities.length - 1;
							const summaryCardX = firstNoteStartX + (lastNoteIndex + 1) * horizontalSpacing;
							const summaryCardY = firstNoteStartY + (lastNoteIndex + 1) * verticalSpacing;
							
							// Get all note contents for summary
							const noteContents: string[] = [];
							for (const note of noteSimilarities.slice(0, 20)) { // Limit to 20 notes to avoid too much text
								try {
									const noteFile = this.app.vault.getAbstractFileByPath(note.notePath);
									if (noteFile instanceof TFile) {
										const content = await this.app.vault.read(noteFile);
										// Extract first paragraph or first 500 chars
										const firstParagraph = content.split('\n\n')[0] || content.substring(0, 500);
										noteContents.push(firstParagraph.substring(0, 500));
									}
								} catch (error) {
									console.warn(`[Thoughtlands:CanvasService] Could not read note ${note.notePath}:`, error);
								}
							}
							
							if (noteContents.length > 0) {
								// Generate summary using local AI - frame as answering the concept/question
								const combinedText = noteContents.join('\n\n');
								const conceptQuestion = centerText || card?.text || 'the concept';
								const prompt = `Based on the following notes, provide a 4-6 sentence summary that answers: "${conceptQuestion}". Focus on the main themes and key insights from these notes. Start directly with the summary content - do not include any introductory phrases like "Here is a summary" or "Summary:".\n\nNotes:\n${combinedText}\n\nSummary:`;
								
								try {
									const response = await fetch(`${this.settings.ollamaUrl}/api/chat`, {
										method: 'POST',
										headers: { 'Content-Type': 'application/json' },
										body: JSON.stringify({
											model: this.settings.ollamaChatModel,
											messages: [
												{ 
													role: 'system', 
													content: 'You are a helpful assistant that creates 4-6 sentence summaries that answer questions or address concepts based on provided notes. Always start directly with the summary content - never include introductory phrases, labels, or prefixes like "Here is a summary", "Summary:", or similar.' 
												},
												{ role: 'user', content: prompt }
											],
											stream: false,
											options: {
												temperature: 0.3,
												num_predict: 300,
											}
										}),
									});
									
									if (response.ok) {
										const data = await response.json();
										let summary = data.message?.content?.trim() || '';
										
										if (summary) {
											// Aggressively remove any prefixes - comprehensive list of common patterns
											const prefixPatterns = [
												/^based on the following notes[,:]?\s*/i,
												/^here is a summary of the notes in \d+-\d+ sentences?[,:]?\s*/i,
												/^here is a summary[,:]?\s*/i,
												/^summary[,:]?\s*/i,
												/^the summary is[,:]?\s*/i,
												/^here is the summary[,:]?\s*/i,
												/^summary of the notes[,:]?\s*/i,
												/^this summary[,:]?\s*/i,
												/^the following summary[,:]?\s*/i,
												/^in summary[,:]?\s*/i,
												/^to summarize[,:]?\s*/i,
												/^summarizing[,:]?\s*/i,
											];
											
											for (const pattern of prefixPatterns) {
												summary = summary.replace(pattern, '').trim();
											}
											
											// Remove leading quotes, dashes, or other punctuation
											summary = summary.replace(/^["'`\-—–]\s*/, '').replace(/\s*["'`\-—–]$/, '');
											
											// Remove any remaining leading colons or dashes
											summary = summary.replace(/^[:;]\s*/, '').trim();
											
											// Create summary card
											const summaryCardId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
											let canvasColor = card?.color || '1';
											if (canvasColor && !canvasColor.match(/^[1-6]$/) && !canvasColor.startsWith('#')) {
												canvasColor = '#' + canvasColor.replace(/^#/, '');
											}
											
											const summaryCard: CanvasNode = {
												id: summaryCardId,
												type: 'text',
												text: summary,
												x: Math.round(summaryCardX - cardWidth / 2),
												y: Math.round(summaryCardY - cardHeight / 2),
												width: cardWidth,
												height: cardHeight,
												color: canvasColor,
												styleAttributes: {
													'font-size': '0.9em',
													'text-align': 'center',
													'border-radius': '8px',
													'border': '2px solid var(--color-accent)',
													'background-color': 'var(--background-secondary)'
												}
											};
											
											canvas.nodes.push(summaryCard);
											addedNodes.push(summaryCard);
											console.log(`[Thoughtlands:CanvasService] Added path summary card at end of path`);
										}
									}
								} catch (error) {
									console.warn(`[Thoughtlands:CanvasService] Failed to generate path summary:`, error);
								}
							}
						}
					} else {
						// Walkabout: Multi-directional arrangement with distance reflecting similarity
						console.log(`[Thoughtlands:CanvasService] Using Walkabout multi-directional arrangement for ${noteSimilarities.length} notes`);
						
						// Get clustering parameters early (used for initial placement and force-directed layout)
						const clusteringValue = clustering ?? 50; // Default to moderate clustering
						const clusteringRatio = clusteringValue / 100; // 0 to 1
						
						// Create center card if not already created
						if (!card && centerText) {
							const cardNodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
							const cardWidth = 400;
							const cardHeight = 150;
							
							const cardNode: CanvasNode = {
								id: cardNodeId,
								type: 'text',
								text: centerText,
								x: Math.round(centerX - cardWidth / 2),
								y: Math.round(centerY - cardHeight / 2),
								width: cardWidth,
								height: cardHeight,
								color: '1'
							};
							
							canvas.nodes.push(cardNode);
							console.log('[Thoughtlands:CanvasService] Created center card with text:', centerText);
						} else if (card) {
							// Place card in center
							const cardNodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
							const cardWidth = 400;
							const cardHeight = 150;
							
							let canvasColor = card.color;
							if (canvasColor && !canvasColor.match(/^[1-6]$/) && !canvasColor.startsWith('#')) {
								canvasColor = '#' + canvasColor.replace(/^#/, '');
							}
							
							const cardNode: CanvasNode = {
								id: cardNodeId,
								type: 'text',
								text: card.text,
								x: Math.round(centerX - cardWidth / 2),
								y: Math.round(centerY - cardHeight / 2),
								width: cardWidth,
								height: cardHeight,
								color: canvasColor
							};
							
							canvas.nodes.push(cardNode);
							console.log('[Thoughtlands:CanvasService] Placed card in center with text:', card.text);
						}
						
						// New walkabout algorithm: radius from center similarity, angle from note-to-note layout
						// Clustering slider: 1-4 (convert from 25-100: 25=1, 50=2, 75=3, 100=4)
						const clusteringLevel = Math.min(4, Math.max(1, Math.floor((clusteringValue - 25) / 25) + 1));
						
						// Step 1 & 2: Collect similarities to center, find min/max
						const similarities = noteSimilarities.map(n => n.similarity);
						const sMin = Math.min(...similarities);
						const sMax = Math.max(...similarities);
						const epsilon = 1e-10;
						
						// Step 3: Define radius bounds (increased to spread notes out more)
						const rMin = 600; // Inner circle
						const rMax = 2400; // Outer ring
						
						// Step 4 & 5: Compute radius for each note from similarity to center
						const noteRadii = new Map<string, number>();
						for (const note of noteSimilarities) {
							const normalizedSimilarity = (note.similarity - sMin) / (sMax - sMin + epsilon);
							let radius = rMin + (1 - normalizedSimilarity) * (rMax - rMin);
							
							// Apply nonlinear radial expansion to give clusters breathing room
							// Normalize radius to [0, 1] range, apply power scaling, then map back
							const normalizedRadius = (radius - rMin) / (rMax - rMin);
							const expandedNormalized = Math.pow(normalizedRadius, 1.25); // Power of 1.25 for mild expansion
							radius = rMin + expandedNormalized * (rMax - rMin);
							
							noteRadii.set(note.notePath, radius);
						}
						
						// Step 3: Compute 2D layout from note-to-note similarities
						// Get embeddings for all notes
						const noteEmbeddings = new Map<string, number[]>();
						for (const note of noteSimilarities) {
							try {
								const storageService = this.embeddingService.getStorageService();
								const embedding = await storageService.getEmbedding(note.file);
								if (embedding) {
									noteEmbeddings.set(note.notePath, embedding);
								}
							} catch (error) {
								console.warn('[Thoughtlands:CanvasService] Failed to get embedding:', note.notePath, error);
							}
						}
						
						// Build similarity matrix
						const noteIndices = new Map<string, number>();
						noteSimilarities.forEach((note, idx) => noteIndices.set(note.notePath, idx));
						
						const n = noteSimilarities.length;
						const similarityMatrix: number[][] = [];
						for (let i = 0; i < n; i++) {
							similarityMatrix[i] = [];
							for (let j = 0; j < n; j++) {
								if (i === j) {
									similarityMatrix[i][j] = 1.0;
								} else {
									const note1 = noteSimilarities[i];
									const note2 = noteSimilarities[j];
									const emb1 = noteEmbeddings.get(note1.notePath);
									const emb2 = noteEmbeddings.get(note2.notePath);
									if (emb1 && emb2) {
										similarityMatrix[i][j] = this.embeddingService.cosineSimilarity(emb1, emb2);
									} else {
										similarityMatrix[i][j] = 0;
									}
								}
							}
						}
						
						// Convert similarities to distances (1 - similarity)
						const distanceMatrix: number[][] = [];
						for (let i = 0; i < n; i++) {
							distanceMatrix[i] = [];
							for (let j = 0; j < n; j++) {
								distanceMatrix[i][j] = 1 - similarityMatrix[i][j];
							}
						}
						
						// Simple force-directed layout for 2D coordinates
						// Initialize positions randomly in a circle
						const layout2D: { x: number; y: number }[] = [];
						for (let i = 0; i < n; i++) {
							const angle = (2 * Math.PI * i) / n;
							const radius = 100;
							layout2D.push({ x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
						}
						
						// Force-directed iterations
						const iterations = 100;
						const k = 50; // Spring constant
						const damping = 0.9;
						
						for (let iter = 0; iter < iterations; iter++) {
							const forces: { x: number; y: number }[] = [];
							for (let i = 0; i < n; i++) {
								forces.push({ x: 0, y: 0 });
							}
							
							// Calculate forces
							for (let i = 0; i < n; i++) {
								for (let j = i + 1; j < n; j++) {
									const dx = layout2D[j].x - layout2D[i].x;
									const dy = layout2D[j].y - layout2D[i].y;
									const dist = Math.sqrt(dx * dx + dy * dy) || 0.1;
									const idealDist = distanceMatrix[i][j] * k;
									const force = (dist - idealDist) / dist;
									
									forces[i].x -= (dx / dist) * force;
									forces[i].y -= (dy / dist) * force;
									forces[j].x += (dx / dist) * force;
									forces[j].y += (dy / dist) * force;
								}
							}
							
							// Apply forces with damping
							for (let i = 0; i < n; i++) {
								layout2D[i].x += forces[i].x * damping;
								layout2D[i].y += forces[i].y * damping;
							}
						}
						
						// Step 4: Center and normalize the 2D layout coordinates
						// Compute mean x and y
						let meanX = 0;
						let meanY = 0;
						for (let i = 0; i < n; i++) {
							meanX += layout2D[i].x;
							meanY += layout2D[i].y;
						}
						meanX /= n;
						meanY /= n;
						
						// Center the layout by subtracting means
						const centeredLayout: { x: number; y: number }[] = [];
						for (let i = 0; i < n; i++) {
							centeredLayout.push({
								x: layout2D[i].x - meanX,
								y: layout2D[i].y - meanY
							});
						}
						
						// Compute standard deviations
						let sumSqX = 0;
						let sumSqY = 0;
						for (let i = 0; i < n; i++) {
							sumSqX += centeredLayout[i].x * centeredLayout[i].x;
							sumSqY += centeredLayout[i].y * centeredLayout[i].y;
						}
						const stdDevX = Math.sqrt(sumSqX / n) || 1; // Avoid division by zero
						const stdDevY = Math.sqrt(sumSqY / n) || 1;
						
						// Scale both axes so their standard deviations are equal
						// Use the average of both std devs as the target to maintain overall scale
						const targetStdDev = (stdDevX + stdDevY) / 2 || 1;
						const normalizedLayout: { x: number; y: number }[] = [];
						for (let i = 0; i < n; i++) {
							normalizedLayout.push({
								x: (centeredLayout[i].x / stdDevX) * targetStdDev,
								y: (centeredLayout[i].y / stdDevY) * targetStdDev
							});
						}
						
						// Convert normalized 2D layout to angles
						const layoutAngles: { idx: number; angle: number }[] = [];
						for (let i = 0; i < n; i++) {
							const angle = Math.atan2(normalizedLayout[i].y, normalizedLayout[i].x);
							layoutAngles.push({ idx: i, angle });
						}
						
						// Sort by angle to preserve relative ordering
						layoutAngles.sort((a, b) => a.angle - b.angle);
						
						// Check for residual swirl: if angles are too clustered, redistribute evenly
						// Calculate angle spread
						let angleSpread = 0;
						for (let i = 0; i < n - 1; i++) {
							let diff = layoutAngles[i + 1].angle - layoutAngles[i].angle;
							if (diff < 0) diff += 2 * Math.PI; // Handle wrap-around
							angleSpread += diff;
						}
						// Handle wrap-around from last to first
						let lastDiff = layoutAngles[0].angle - layoutAngles[n - 1].angle;
						if (lastDiff < 0) lastDiff += 2 * Math.PI;
						angleSpread += lastDiff;
						
						const avgAngleGap = angleSpread / n;
						const maxGap = Math.max(...Array.from({ length: n }, (_, i) => {
							const nextIdx = (i + 1) % n;
							let diff = layoutAngles[nextIdx].angle - layoutAngles[i].angle;
							if (diff < 0) diff += 2 * Math.PI;
							return diff;
						}));
						
						// If there's a large gap (indicating clustering), redistribute evenly
						// But preserve relative ordering within clusters
						const freeAngles = new Map<string, number>();
						if (maxGap > avgAngleGap * 3) {
							// Significant clustering detected - redistribute evenly while preserving order
							for (let i = 0; i < n; i++) {
								const note = noteSimilarities[layoutAngles[i].idx];
								const angle = (2 * Math.PI * i) / n;
								freeAngles.set(note.notePath, angle);
							}
						} else {
							// Use normalized angles directly, but apply global rotation to balance layout
							// Find the angle that minimizes the maximum gap
							let bestRotation = 0;
							let minMaxGap = Infinity;
							for (let rot = 0; rot < 2 * Math.PI; rot += Math.PI / 18) { // Try rotations in 10-degree steps
								const rotatedAngles = layoutAngles.map(la => {
									let angle = la.angle + rot;
									if (angle > Math.PI) angle -= 2 * Math.PI;
									if (angle < -Math.PI) angle += 2 * Math.PI;
									return angle;
								}).sort((a, b) => a - b);
								
								let maxGap = 0;
								for (let i = 0; i < rotatedAngles.length - 1; i++) {
									let diff = rotatedAngles[i + 1] - rotatedAngles[i];
									if (diff < 0) diff += 2 * Math.PI;
									maxGap = Math.max(maxGap, diff);
								}
								// Handle wrap-around
								let lastDiff = rotatedAngles[0] - rotatedAngles[rotatedAngles.length - 1];
								if (lastDiff < 0) lastDiff += 2 * Math.PI;
								maxGap = Math.max(maxGap, lastDiff);
								
								if (maxGap < minMaxGap) {
									minMaxGap = maxGap;
									bestRotation = rot;
								}
							}
							
							// Apply best rotation
							for (let i = 0; i < n; i++) {
								const note = noteSimilarities[layoutAngles[i].idx];
								let angle = layoutAngles[i].angle + bestRotation;
								// Normalize to [-π, π]
								while (angle > Math.PI) angle -= 2 * Math.PI;
								while (angle < -Math.PI) angle += 2 * Math.PI;
								freeAngles.set(note.notePath, angle);
							}
						}
						
						// Step 5: Compute "free" positions (evenly distributed)
						const freePositions = new Map<string, { x: number; y: number }>();
						for (const note of noteSimilarities) {
							const radius = noteRadii.get(note.notePath)!;
							const angle = freeAngles.get(note.notePath)!;
							freePositions.set(note.notePath, {
								x: centerX + radius * Math.cos(angle),
								y: centerY + radius * Math.sin(angle)
							});
						}
						
						// Step 6: Cluster notes using k-means on normalized 2D layout
						const numClusters = Math.min(8, Math.max(3, Math.ceil(n / 5)));
						const clusters = this.kMeansClustering(normalizedLayout, numClusters);
						
						// Step 7: Compute cluster angles from normalized layout positions
						const clusterAngles = new Map<number, number>();
						for (let c = 0; c < numClusters; c++) {
							const clusterNotes = clusters.get(c) || [];
							if (clusterNotes.length === 0) continue;
							
							// Average angles from normalized layout positions using sin/cos to handle wrapping
							let sumSin = 0;
							let sumCos = 0;
							for (const idx of clusterNotes) {
								const layoutAngle = Math.atan2(normalizedLayout[idx].y, normalizedLayout[idx].x);
								sumSin += Math.sin(layoutAngle);
								sumCos += Math.cos(layoutAngle);
							}
							const avgAngle = Math.atan2(sumSin / clusterNotes.length, sumCos / clusterNotes.length);
							clusterAngles.set(c, avgAngle);
						}
						
						// Step 8: Compute cluster-based positions with spread
						// Prepare cluster member lists for even spacing
						const clusterMembers = new Map<number, number[]>();
						for (let i = 0; i < n; i++) {
							const clusterId = this.getClusterForNote(i, clusters);
							if (!clusterMembers.has(clusterId)) {
								clusterMembers.set(clusterId, []);
							}
							clusterMembers.get(clusterId)!.push(i);
						}
						
						const clusterPositions = new Map<string, { x: number; y: number }>();
						for (let i = 0; i < n; i++) {
							const note = noteSimilarities[i];
							const clusterId = this.getClusterForNote(i, clusters);
							const clusterAngle = clusterAngles.get(clusterId) || freeAngles.get(note.notePath)!;
							const radius = noteRadii.get(note.notePath)!;
							
							// Calculate spread based on clustering level
							// At level 1 (alpha = 0): no spread, use free positions
							// At level 4 (alpha = 1): tight spread, small offsets
							const alpha = (clusteringLevel - 1) / 3; // 0 to 1 (for levels 1-4)
							
							// Spread parameters: tighter at higher clustering, but always maintain spacing
							// Ensure adequate spacing at mid-levels (especially level 3)
							const maxRadialSpread = 120 * (1 - alpha * 0.5); // 120px at level 1, 60px at level 5
							const maxAngularSpread = (Math.PI / 6) * (1 - alpha * 0.6); // ~30° at level 1, ~12° at level 5
							
							// Get position within cluster for even spacing
							const members = clusterMembers.get(clusterId) || [i];
							const memberIndex = members.indexOf(i);
							const memberCount = members.length;
							
							// Evenly space members within cluster
							let radialOffset = 0;
							let angularOffset = 0;
							
							// Always apply some spread to prevent overlap, even at low clustering
							if (memberCount > 1) {
								// Radial offset: distribute evenly along radius
								// Use a pattern that spreads notes out more
								const radialStep = (2 * maxRadialSpread) / Math.max(1, memberCount - 1);
								radialOffset = -maxRadialSpread + (memberIndex * radialStep);
								
								// Angular offset: distribute evenly around cluster angle
								const angleStep = (2 * maxAngularSpread) / Math.max(1, memberCount - 1);
								angularOffset = -maxAngularSpread + (memberIndex * angleStep);
							}
							
							// Ensure final radius doesn't pull notes too close to center
							// At mid-levels (especially level 3), ensure notes maintain distance from center
							// Prevent radial offsets from pulling notes too close
							let adjustedRadius = radius + radialOffset;
							if (alpha > 0.3 && alpha < 0.7) {
								// At mid-levels, ensure minimum distance from center
								// Scale radial offset to be less aggressive inward
								if (radialOffset < 0) {
									// Limit inward pull to maintain spacing from center
									adjustedRadius = Math.max(radius * 0.95, radius + radialOffset * 0.3);
								} else {
									adjustedRadius = radius + radialOffset;
								}
								// Add extra minimum buffer at mid-levels to push notes out significantly
								// Ensure notes are at least 25% of the way from min to max radius
								adjustedRadius = Math.max(adjustedRadius, rMin + (rMax - rMin) * 0.25);
							}
							const finalRadius = Math.max(rMin, adjustedRadius);
							const finalAngle = clusterAngle + angularOffset;
							
							clusterPositions.set(note.notePath, {
								x: centerX + finalRadius * Math.cos(finalAngle),
								y: centerY + finalRadius * Math.sin(finalAngle)
							});
						}
						
						// Step 9: Interpolate based on clustering slider (1-4)
						const alpha = (clusteringLevel - 1) / 3; // 0 to 1 (for levels 1-4)
						
						// Step 10: Render notes with smooth transitions
						for (const note of noteSimilarities) {
							const freePos = freePositions.get(note.notePath)!;
							const clusterPos = clusterPositions.get(note.notePath)!;
							
							// Smooth interpolation with easing for better visual transition
							const easedAlpha = alpha < 0.5 
								? 2 * alpha * alpha 
								: 1 - Math.pow(-2 * alpha + 2, 2) / 2; // Ease-in-out quadratic
							
							const xFinal = (1 - easedAlpha) * freePos.x + easedAlpha * clusterPos.x;
							const yFinal = (1 - easedAlpha) * freePos.y + easedAlpha * clusterPos.y;
							
							const nodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
							const noteNode: CanvasNode = {
								id: nodeId,
								type: 'file',
								file: note.notePath,
								x: Math.round(xFinal - nodeWidth / 2),
								y: Math.round(yFinal - nodeHeight / 2),
								width: nodeWidth,
								height: nodeHeight,
								styleAttributes: {},
							};
							canvas.nodes.push(noteNode);
							addedNodes.push(noteNode);
						}
						
						console.log(`[Thoughtlands:CanvasService] Placed ${addedNodes.length} notes using new walkabout layout (clustering level=${clusteringLevel}, alpha=${alpha.toFixed(2)})`);
						
						// Step 11: Add cluster summary cards at level 4
						if (clusteringLevel === 4 && this.localAIService && this.settings && this.settings.aiMode === 'local') {
							// Update status: generating summaries
							if (this.plugin && (this.plugin as any).updateRegionCreationStatus) {
								(this.plugin as any).updateRegionCreationStatus({
									isCreating: true,
									step: 'Generating cluster summaries...',
									details: 'Creating summary cards for clusters'
								});
							}
							await this.addClusterSummaryCards(canvas, clusters, noteSimilarities, clusterAngles, noteRadii, centerX, centerY, card?.color);
						}
					}
				} else {
					// No center embedding, use regular grid arrangement
					// (fall through to grid code below)
				}
			} else {
				// Regular grid arrangement (no semantic similarity)
				// (fall through to grid code below)
			}
			
			// Regular arrangement (grid layout) if:
			// - Not using similarity arrangement, OR
			// - No embedding service, OR  
			// - Similarity arrangement was attempted but no nodes were added (fallback)
			// Note: Crowd mode handles its own layout above, so we don't force grid layout for it
			const semanticMode = region.source.processingInfo?.semanticSimilarityMode;
			const useGridLayout = !arrangeBySimilarity || 
			                       !this.embeddingService || 
			                       (arrangeBySimilarity && addedNodes.length === 0);
			
			console.log(`[Thoughtlands:CanvasService] useGridLayout check: arrangeBySimilarity=${arrangeBySimilarity}, embeddingService=${!!this.embeddingService}, semanticMode=${semanticMode}, addedNodes.length=${addedNodes.length}, useGridLayout=${useGridLayout}`);
			
			if (useGridLayout) {
				let currentX = existingNodes.length > 0 ? maxX + 400 : 100;
				let currentY = existingNodes.length > 0 ? 200 : 100;
				
				// Add card text node if requested (place it above the file nodes)
				if (card) {
					const cardNodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
					const cardX = currentX;
					const cardY = currentY - 250; // Place card above the file nodes
					const cardWidth = 400;
					const cardHeight = 150;

					// Convert hex color to Obsidian canvas format
					// Obsidian accepts palette colors '1'-'6' or hex colors '#RRGGBB'
					let canvasColor = card.color;
					// If it's a hex color, ensure it's in the correct format
					if (canvasColor && !canvasColor.match(/^[1-6]$/) && !canvasColor.startsWith('#')) {
						// If it's not a palette number and doesn't start with #, add #
						canvasColor = '#' + canvasColor.replace(/^#/, '');
					}
					
					const cardNode: CanvasNode = {
						id: cardNodeId,
						type: 'text',
						text: card.text,
						x: Math.round(cardX),
						y: Math.round(cardY),
						width: cardWidth,
						height: cardHeight,
						color: canvasColor // Use direct property - accepts '1'-'6' or '#RRGGBB'
					};

					canvas.nodes.push(cardNode);
					console.log('[Thoughtlands:CanvasService] Added card node with text:', card.text);
				}

				// Add each note as a file node (no master card, no edges)
			let rowCount = 0;
			const nodesPerRow = 8; // More notes per row for wider layout
				addedNodes = [];

			for (const notePath of region.notes) {
				const noteFile = this.app.vault.getAbstractFileByPath(notePath);
				if (!(noteFile instanceof TFile)) {
					console.warn('[Thoughtlands:CanvasService] Note file not found:', notePath);
					continue;
				}

				// Generate a unique node ID - Obsidian uses simple hex IDs (16 characters)
				// Format: 16 hex characters, similar to Obsidian's pattern
				const nodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
				const nodeX = currentX + (rowCount % nodesPerRow) * (nodeWidth + spacing);
				const nodeY = currentY + Math.floor(rowCount / nodesPerRow) * (nodeHeight + spacing);

				// Create file node with proper Obsidian canvas format
				// Obsidian canvas file nodes require: id, type, file, x, y, width, height, styleAttributes
				// The file path should be relative to vault root
				// Ensure all values are valid numbers
				const roundedX = Math.round(nodeX);
				const roundedY = Math.round(nodeY);
				
				const noteNode: CanvasNode = {
					id: nodeId,
					type: 'file',
					file: notePath, // Path relative to vault root (e.g., "Folder/Note.md")
					x: roundedX,
					y: roundedY,
					width: nodeWidth,
					height: nodeHeight,
					styleAttributes: {}, // Required empty object
				};
				
				// Validate node before adding
				if (!noteNode.id || !noteNode.type || !noteNode.file || 
					isNaN(noteNode.x) || isNaN(noteNode.y) || 
					isNaN(noteNode.width) || isNaN(noteNode.height)) {
					console.error('[Thoughtlands:CanvasService] Invalid node structure:', noteNode);
					continue; // Skip invalid nodes
				}
				
				// Log the node structure for debugging
				if (rowCount === 0) {
					console.log('[Thoughtlands:CanvasService] First node structure:', JSON.stringify(noteNode, null, 2));
					console.log('[Thoughtlands:CanvasService] Note file exists:', noteFile instanceof TFile, 'Path:', notePath);
					console.log('[Thoughtlands:CanvasService] Node coordinates:', { x: roundedX, y: roundedY });
				}
				canvas.nodes.push(noteNode);
				addedNodes.push(noteNode);
				rowCount++;
				}
			}
			
			// addedNodes is already populated from the arrangement above

			// Create edges based on [[links]] if requested
			if (drawConnections) {
				console.log('[Thoughtlands:CanvasService] Creating edges from links');
				const nodeMap = new Map<string, string>(); // Map note path to node ID
				const nodePositionMap = new Map<string, { x: number; y: number; width: number; height: number }>(); // Map node ID to position
				
				// Build maps for all nodes (both existing and newly added)
				[...canvas.nodes, ...addedNodes].forEach(node => {
					if (node.file) {
						nodeMap.set(node.file, node.id);
					}
					// Store position for edge point calculation
					nodePositionMap.set(node.id, {
						x: node.x || 0,
						y: node.y || 0,
						width: node.width || 280,
						height: node.height || 200
					});
				});
				
				// Helper function to determine best edge sides based on node positions
				const getConnectionSides = (sourceNodeId: string, targetNodeId: string): { fromSide: string; toSide: string } => {
					const sourcePos = nodePositionMap.get(sourceNodeId);
					const targetPos = nodePositionMap.get(targetNodeId);
					
					if (!sourcePos || !targetPos) {
						// Fallback to default if positions not found
						return { fromSide: 'right', toSide: 'left' };
					}
					
					// Calculate center points
					const sourceCenterX = sourcePos.x + sourcePos.width / 2;
					const sourceCenterY = sourcePos.y + sourcePos.height / 2;
					const targetCenterX = targetPos.x + targetPos.width / 2;
					const targetCenterY = targetPos.y + targetPos.height / 2;
					
					// Calculate direction vector
					const dx = targetCenterX - sourceCenterX;
					const dy = targetCenterY - sourceCenterY;
					
					// Determine primary direction (horizontal or vertical)
					const absDx = Math.abs(dx);
					const absDy = Math.abs(dy);
					
					let fromSide: string;
					let toSide: string;
					
					if (absDx > absDy) {
						// Primarily horizontal edge
						if (dx > 0) {
							// Target is to the right of source
							fromSide = 'right';
							toSide = 'left';
						} else {
							// Target is to the left of source
							fromSide = 'left';
							toSide = 'right';
						}
					} else {
						// Primarily vertical edge
						if (dy > 0) {
							// Target is below source
							fromSide = 'bottom';
							toSide = 'top';
						} else {
							// Target is above source
							fromSide = 'top';
							toSide = 'bottom';
						}
					}
					
					return { fromSide, toSide };
				};

				// Extract links from each note and create edges
				for (const notePath of region.notes) {
					const sourceNodeId = nodeMap.get(notePath);
					if (!sourceNodeId) continue;

					try {
						const noteFile = this.app.vault.getAbstractFileByPath(notePath);
						if (!(noteFile instanceof TFile)) continue;

						const content = await this.app.vault.read(noteFile);
						// Extract [[links]] from content
						const linkRegex = /\[\[([^\]]+)\]\]/g;
						const links: string[] = [];
						let match;
						while ((match = linkRegex.exec(content)) !== null) {
							const linkText = match[1];
							// Handle aliases: [[link|alias]] -> just get the link part
							const linkPath = linkText.split('|')[0].trim();
							links.push(linkPath);
						}

						// Create edges for links that point to other notes in the region
						for (const linkPath of links) {
							// Try to find the target file (handle various path formats)
							let targetNodeId: string | null = null;
							
							// Normalize link path (remove .md extension if present, handle paths)
							const normalizedLink = linkPath.replace(/\.md$/, '');
							
							// Try exact match first (with and without .md)
							if (nodeMap.has(linkPath)) {
								targetNodeId = nodeMap.get(linkPath)!;
							} else if (nodeMap.has(`${linkPath}.md`)) {
								targetNodeId = nodeMap.get(`${linkPath}.md`)!;
							} else {
								// Try to find by resolving the link using Obsidian's link resolution
								try {
									// Use Obsidian's metadata cache to resolve the link
									const linkFile = this.app.metadataCache.getFirstLinkpathDest(normalizedLink, noteFile.path);
									if (linkFile && linkFile instanceof TFile) {
										const resolvedPath = linkFile.path;
										if (nodeMap.has(resolvedPath)) {
											targetNodeId = nodeMap.get(resolvedPath)!;
										}
									}
								} catch (error) {
									// Fall through to basename matching
								}
								
								// Fallback: Try to find by basename
								if (!targetNodeId) {
									const linkBasename = normalizedLink.split('/').pop() || normalizedLink;
									for (const [path, nodeId] of nodeMap.entries()) {
										const pathBasename = path.split('/').pop()?.replace(/\.md$/, '');
										if (pathBasename && pathBasename.toLowerCase() === linkBasename.toLowerCase()) {
											targetNodeId = nodeId;
											break;
										}
									}
								}
							}

							if (targetNodeId && targetNodeId !== sourceNodeId) {
								// Check if edge already exists (by from/to nodes)
								const edgeExists = canvas.edges.some((e: any) => 
									e.fromNode === sourceNodeId && e.toNode === targetNodeId
								);
								
								if (!edgeExists) {
									// Determine best edge sides based on node positions
									const { fromSide, toSide } = getConnectionSides(sourceNodeId, targetNodeId);
									
									// Use same ID format as nodes (random hex string) to match Obsidian's format
									// Ensure ID is unique by checking against existing edge IDs
									let edgeId: string;
									let attempts = 0;
									do {
										edgeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
										attempts++;
										if (attempts > 100) {
											// Fallback: use timestamp-based ID if we can't generate unique random one
											edgeId = `edge-${sourceNodeId}-${targetNodeId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
											break;
										}
									} while (canvas.edges.some((e: any) => e.id === edgeId));
									
								const edge: CanvasEdge = {
									id: edgeId,
									fromNode: sourceNodeId,
										fromSide: fromSide,
									toNode: targetNodeId,
										toSide: toSide,
									styleAttributes: {}
								};
								canvas.edges.push(edge);
									console.log(`[Thoughtlands:CanvasService] Created edge ${edgeId} from ${notePath} to ${linkPath} (${fromSide} -> ${toSide})`);
								}
							}
						}
					} catch (error) {
						console.warn('[Thoughtlands:CanvasService] Error reading note for links:', notePath, error);
					}
				}
				
				console.log('[Thoughtlands:CanvasService] Created', canvas.edges.length, 'edges from links');
			}

			console.log('[Thoughtlands:CanvasService] Added', addedNodes.length, 'nodes to canvas');
			console.log('[Thoughtlands:CanvasService] Canvas now has', canvas.nodes.length, 'total nodes');
			if (addedNodes.length > 0) {
				console.log('[Thoughtlands:CanvasService] Example new node:', JSON.stringify(addedNodes[0], null, 2));
			}

			// Before writing, re-read the file to ensure we have the latest version
			// This captures any edges that might have been manually created in Obsidian
			// between when we first read the file and now
			try {
				const latestCanvasData = await this.app.vault.read(canvasFile);
				const latestCanvas: CanvasData = JSON.parse(latestCanvasData);
				
				// Merge any new edges that weren't in our original read
				if (latestCanvas.edges && latestCanvas.edges.length > 0) {
					const existingEdgeIds = new Set(canvas.edges.map((e: any) => e.id));
					const newEdgesFromFile = latestCanvas.edges.filter((e: any) => !existingEdgeIds.has(e.id));
					
					if (newEdgesFromFile.length > 0) {
						console.log('[Thoughtlands:CanvasService] Found', newEdgesFromFile.length, 'additional edges from latest file read, merging them');
						canvas.edges.push(...newEdgesFromFile);
					}
					
					// Also update any edges that might have changed (by ID)
					// But preserve our newly created edges - only update if the edge already existed
					for (const latestEdge of latestCanvas.edges) {
						const existingIndex = canvas.edges.findIndex((e: any) => e.id === latestEdge.id);
						if (existingIndex >= 0) {
							// Only update if this edge existed before we started adding new ones
							// (i.e., it's not one we just created)
							if (existingIndex < existingEdgesBefore) {
								// Update existing edge with latest version from file
								canvas.edges[existingIndex] = latestEdge;
							}
							// If it's a new edge we created, keep our version
						}
					}
				}
				
				// Also merge any new nodes
				if (latestCanvas.nodes && latestCanvas.nodes.length > 0) {
					const existingNodeIds = new Set(canvas.nodes.map((n: any) => n.id));
					const newNodesFromFile = latestCanvas.nodes.filter((n: any) => !existingNodeIds.has(n.id));
					
					if (newNodesFromFile.length > 0) {
						console.log('[Thoughtlands:CanvasService] Found', newNodesFromFile.length, 'additional nodes from latest file read, merging them');
						canvas.nodes.push(...newNodesFromFile);
					}
				}
			} catch (error) {
				console.warn('[Thoughtlands:CanvasService] Could not re-read canvas file before writing:', error);
				// Continue with what we have
			}

			// Write back to canvas file with proper formatting
			// Obsidian uses tabs for indentation in canvas files
			// Remove any undefined or null values that might cause issues
			// Preserve all existing edges and nodes
			const totalEdgeCount = canvas.edges.length;
			const newEdgesCount = totalEdgeCount - existingEdgesBefore;
			
			// Filter out invalid edges but preserve all valid ones
			const validEdges = canvas.edges.filter((e: any) => {
				if (!e || !e.id) return false;
				// Edges must have fromNode and toNode
				if (!e.fromNode || !e.toNode) {
					console.warn('[Thoughtlands:CanvasService] Filtering out invalid edge (missing fromNode or toNode):', e);
					return false;
				}
				return true;
			});
			
			const validNodes = canvas.nodes.filter((n: any) => n != null && n.id);
			
			const cleanCanvas = {
				nodes: validNodes,
				edges: validEdges,
				metadata: canvas.metadata || { version: '1.0-1.0' }
			};
			
			const jsonContent = JSON.stringify(cleanCanvas, null, '\t');
			console.log('[Thoughtlands:CanvasService] Writing canvas file with', cleanCanvas.nodes.length, 'nodes and', cleanCanvas.edges.length, 'edges');
			console.log('[Thoughtlands:CanvasService] Edge preservation: started with', existingEdgesBefore, 'existing edges, added', newEdgesCount, 'new edges, total', totalEdgeCount, 'edges, writing', validEdges.length, 'valid edges');
			if (validEdges.length < totalEdgeCount) {
				console.warn('[Thoughtlands:CanvasService] WARNING: Some edges were filtered out!', totalEdgeCount - validEdges.length, 'edges removed');
			}
			console.log('[Thoughtlands:CanvasService] Canvas structure:', {
				nodesCount: cleanCanvas.nodes.length,
				edgesCount: cleanCanvas.edges.length,
				hasMetadata: !!cleanCanvas.metadata,
				firstNode: cleanCanvas.nodes[0],
				firstEdge: cleanCanvas.edges[0],
				allEdgeIds: cleanCanvas.edges.map((e: any) => e.id)
			});
			
			// Write the file
			await this.app.vault.modify(canvasFile, jsonContent);
			
			console.log('[Thoughtlands:CanvasService] Canvas file updated successfully');
			
			// Force a complete reload by closing all canvas views and reopening
			const canvasLeaves = this.app.workspace.getLeavesOfType('canvas');
			const wasOpen = canvasLeaves.some(leaf => {
				const view = leaf.view as any;
				return view?.file?.path === canvasFile.path;
			});
			
			// Close all canvas views for this file
			for (const leaf of canvasLeaves) {
				const view = leaf.view as any;
				if (view?.file?.path === canvasFile.path) {
					console.log('[Thoughtlands:CanvasService] Closing canvas view');
					await leaf.detach();
				}
			}
			
			// If it was open, reopen it after a delay to ensure file is fully written
			if (wasOpen) {
				setTimeout(async () => {
					console.log('[Thoughtlands:CanvasService] Reopening canvas view');
					await this.app.workspace.openLinkText(canvasFile.path, '', true);
					// Force a refresh of the canvas view
					setTimeout(() => {
						const newLeaves = this.app.workspace.getLeavesOfType('canvas');
						for (const leaf of newLeaves) {
							const view = leaf.view as any;
							if (view?.file?.path === canvasFile.path) {
								// Try to trigger a refresh
								if (view.requestSave) {
									view.requestSave();
								}
								if (view.load) {
									view.load();
								}
							}
						}
					}, 200);
				}, 300);
			}

			// Clear status
			if (this.plugin && (this.plugin as any).updateRegionCreationStatus) {
				(this.plugin as any).updateRegionCreationStatus({ isCreating: false });
			}
			
			// Return the canvas path and whether it was new
			return { path: canvasFile.path, isNew: isNewCanvas };
		} catch (error) {
			console.error('[Thoughtlands:CanvasService] Error adding region to canvas:', error);
			// Clear status on error
			if (this.plugin && (this.plugin as any).updateRegionCreationStatus) {
				(this.plugin as any).updateRegionCreationStatus({ isCreating: false });
			}
			return null;
		}
	}

	getAllCanvasFiles(): TFile[] {
		const allFiles = this.app.vault.getFiles();
		return allFiles.filter(file => file.extension === 'canvas');
	}

	// K-means clustering helper
	private kMeansClustering(points: { x: number; y: number }[], k: number, maxIterations: number = 50): Map<number, number[]> {
		const n = points.length;
		if (n === 0) return new Map();
		
		// Initialize centroids randomly
		const centroids: { x: number; y: number }[] = [];
		for (let i = 0; i < k; i++) {
			const idx = Math.floor(Math.random() * n);
			centroids.push({ x: points[idx].x, y: points[idx].y });
		}
		
		let clusters: Map<number, number[]> = new Map();
		
		for (let iter = 0; iter < maxIterations; iter++) {
			// Assign points to nearest centroid
			clusters = new Map();
			for (let i = 0; i < k; i++) {
				clusters.set(i, []);
			}
			
			for (let i = 0; i < n; i++) {
				let minDist = Infinity;
				let nearestCluster = 0;
				for (let j = 0; j < k; j++) {
					const dx = points[i].x - centroids[j].x;
					const dy = points[i].y - centroids[j].y;
					const dist = Math.sqrt(dx * dx + dy * dy);
					if (dist < minDist) {
						minDist = dist;
						nearestCluster = j;
					}
				}
				clusters.get(nearestCluster)!.push(i);
			}
			
			// Update centroids
			let moved = false;
			for (let j = 0; j < k; j++) {
				const clusterPoints = clusters.get(j)!;
				if (clusterPoints.length === 0) continue;
				
				let sumX = 0;
				let sumY = 0;
				for (const idx of clusterPoints) {
					sumX += points[idx].x;
					sumY += points[idx].y;
				}
				const newX = sumX / clusterPoints.length;
				const newY = sumY / clusterPoints.length;
				
				if (Math.abs(centroids[j].x - newX) > 0.01 || Math.abs(centroids[j].y - newY) > 0.01) {
					moved = true;
				}
				centroids[j].x = newX;
				centroids[j].y = newY;
			}
			
			if (!moved) break;
		}
		
		return clusters;
	}

	// Get cluster ID for a note index
	private getClusterForNote(noteIndex: number, clusters: Map<number, number[]>): number {
		for (const [clusterId, noteIndices] of clusters.entries()) {
			if (noteIndices.includes(noteIndex)) {
				return clusterId;
			}
		}
		return 0; // Default to cluster 0
	}

	private async addClusterSummaryCards(
		canvas: CanvasData,
		clusters: Map<number, number[]>,
		noteSimilarities: { notePath: string; similarity: number }[],
		clusterAngles: Map<number, number>,
		noteRadii: Map<string, number>,
		centerX: number,
		centerY: number,
		cardColor?: string
	): Promise<void> {
		if (!this.localAIService || !this.settings) return;

		const cardWidth = 300;
		const cardHeight = 100;

		for (const [clusterId, noteIndices] of clusters.entries()) {
			if (noteIndices.length <= 1) continue; // Skip clusters with 1 or fewer notes

			// Get note files for this cluster
			const clusterNotes = noteIndices.map(idx => {
				const notePath = noteSimilarities[idx].notePath;
				return this.app.vault.getAbstractFileByPath(notePath);
			}).filter(file => file instanceof TFile) as TFile[];

			if (clusterNotes.length === 0) continue;

			// Read note contents (first 500 chars of each)
			const noteContents: string[] = [];
			for (const noteFile of clusterNotes.slice(0, 10)) { // Limit to 10 notes to avoid too much text
				try {
					const content = await this.app.vault.read(noteFile);
					// Extract first paragraph or first 500 chars
					const firstParagraph = content.split('\n\n')[0] || content.substring(0, 500);
					noteContents.push(firstParagraph.substring(0, 500));
				} catch (error) {
					console.warn(`[Thoughtlands:CanvasService] Could not read note ${noteFile.path}:`, error);
				}
			}

			if (noteContents.length === 0) continue;

			// Generate summary using local AI
			const combinedText = noteContents.join('\n\n');
			const prompt = `Summarize the following notes in 4-6 sentences. Focus on the common themes and main ideas. Start directly with the summary content - do not include any introductory phrases like "Here is a summary" or "Summary:".\n\n${combinedText}\n\nSummary:`;

			try {
				const response = await fetch(`${this.settings.ollamaUrl}/api/chat`, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						model: this.settings.ollamaChatModel,
						messages: [
							{ role: 'system', content: 'You are a helpful assistant that creates 4-6 sentence summaries. Always start directly with the summary content - never include introductory phrases, labels, or prefixes like "Here is a summary", "Summary:", or similar.' },
							{ role: 'user', content: prompt }
						],
						stream: false,
						options: {
							temperature: 0.3,
							num_predict: 300,
						}
					}),
				});

				if (!response.ok) continue;

				const data = await response.json();
				let summary = data.message?.content?.trim() || '';
				if (!summary) continue;
				
				// Aggressively remove any prefixes - comprehensive list of common patterns
				const prefixPatterns = [
					/^based on the following notes[,:]?\s*/i,
					/^here is a summary of the notes in \d+-\d+ sentences?[,:]?\s*/i,
					/^here is a summary[,:]?\s*/i,
					/^summary[,:]?\s*/i,
					/^the summary is[,:]?\s*/i,
					/^here is the summary[,:]?\s*/i,
					/^summary of the notes[,:]?\s*/i,
					/^this summary[,:]?\s*/i,
					/^the following summary[,:]?\s*/i,
					/^in summary[,:]?\s*/i,
					/^to summarize[,:]?\s*/i,
					/^summarizing[,:]?\s*/i,
				];
				
				for (const pattern of prefixPatterns) {
					summary = summary.replace(pattern, '').trim();
				}
				
				// Remove leading quotes, dashes, or other punctuation
				summary = summary.replace(/^["'`\-—–]\s*/, '').replace(/\s*["'`\-—–]$/, '');
				
				// Remove any remaining leading colons or dashes
				summary = summary.replace(/^[:;]\s*/, '').trim();

				// Calculate position for summary card (near cluster center)
				const clusterAngle = clusterAngles.get(clusterId);
				if (clusterAngle === undefined) continue;

				// Get average radius for cluster
				let avgRadius = 0;
				for (const idx of noteIndices) {
					const notePath = noteSimilarities[idx].notePath;
					avgRadius += noteRadii.get(notePath) || 0;
				}
				avgRadius = avgRadius / noteIndices.length;

				// Place card slightly outside the cluster
				const cardRadius = avgRadius + 150;
				const cardX = centerX + cardRadius * Math.cos(clusterAngle);
				const cardY = centerY + cardRadius * Math.sin(clusterAngle);

				// Create summary card
				const cardNodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
				let canvasColor = cardColor || '1';
				if (canvasColor && !canvasColor.match(/^[1-6]$/) && !canvasColor.startsWith('#')) {
					canvasColor = '#' + canvasColor.replace(/^#/, '');
				}

				const summaryCard: CanvasNode = {
					id: cardNodeId,
					type: 'text',
					text: summary,
					x: Math.round(cardX - cardWidth / 2),
					y: Math.round(cardY - cardHeight / 2),
					width: cardWidth,
					height: cardHeight,
					color: canvasColor
				};

				canvas.nodes.push(summaryCard);
				console.log(`[Thoughtlands:CanvasService] Added summary card for cluster ${clusterId} with ${noteIndices.length} notes`);
			} catch (error) {
				console.warn(`[Thoughtlands:CanvasService] Failed to generate summary for cluster ${clusterId}:`, error);
			}
		}
	}
}

