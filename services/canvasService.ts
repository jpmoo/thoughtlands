import { App, TFile } from 'obsidian';
import { Region } from '../models/region';
import { EmbeddingService } from './embeddingService';

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

	constructor(app: App, embeddingService?: EmbeddingService) {
		this.app = app;
		this.embeddingService = embeddingService;
	}

	async addRegionToCanvas(canvasFile: TFile, region: Region, isNewCanvas: boolean = false, drawConnections: boolean = false, card?: { text: string; color: string }, arrangeBySimilarity: boolean = false): Promise<{ path: string; isNew: boolean } | null> {
		try {
			console.log('[Thoughtlands:CanvasService] Adding region to canvas:', region.name, canvasFile.path);
			
			// Read the canvas file
			const canvasData = await this.app.vault.read(canvasFile);
			let canvas: CanvasData;

			try {
				canvas = JSON.parse(canvasData);
				console.log('[Thoughtlands:CanvasService] Loaded existing canvas with', canvas.nodes?.length || 0, 'nodes');
				// Log an example node structure if nodes exist
				if (canvas.nodes && canvas.nodes.length > 0) {
					console.log('[Thoughtlands:CanvasService] Example existing node:', JSON.stringify(canvas.nodes[0], null, 2));
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
				
				// Get center embedding (from card text or generate from region name/concept)
				let centerEmbedding: number[] | null = null;
				let centerText = '';
				
				if (card) {
					// Use card text as center
					centerText = card.text;
					try {
						centerEmbedding = await this.embeddingService.generateEmbedding(card.text);
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
					} catch (error) {
						console.warn('[Thoughtlands:CanvasService] Failed to generate embedding for center:', error);
					}
				}
				
				// If we have a center embedding, arrange notes in a circle
				if (centerEmbedding) {
					// Calculate similarity scores for all notes
					const noteSimilarities: { notePath: string; similarity: number; file: TFile }[] = [];
					
					for (const notePath of region.notes) {
						const noteFile = this.app.vault.getAbstractFileByPath(notePath);
						if (!(noteFile instanceof TFile)) {
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
								}
							}
						} catch (error) {
							console.warn('[Thoughtlands:CanvasService] Failed to get embedding for note:', notePath, error);
						}
					}
					
					// Sort by similarity (highest first)
					noteSimilarities.sort((a, b) => b.similarity - a.similarity);
					
					console.log(`[Thoughtlands:CanvasService] Found ${noteSimilarities.length} notes with embeddings for similarity arrangement`);
					
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
							color: '1' // Use Obsidian canvas palette color (1-6) or hex
						};
						
						canvas.nodes.push(cardNode);
						console.log('[Thoughtlands:CanvasService] Created center card with text:', centerText);
					} else if (card) {
						// Place card in center
						const cardNodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
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
							x: Math.round(centerX - cardWidth / 2),
							y: Math.round(centerY - cardHeight / 2),
							width: cardWidth,
							height: cardHeight,
							color: canvasColor // Use direct property - accepts '1'-'6' or '#RRGGBB'
						};
						
						canvas.nodes.push(cardNode);
						console.log('[Thoughtlands:CanvasService] Placed card in center with text:', card.text);
					}
					
					// Arrange notes in a circle based on similarity
					// Group notes by similarity (with small tolerance for "same" similarity)
					const similarityTolerance = 0.001; // Notes within this range are considered same similarity
					const similarityGroups: { similarity: number; notes: typeof noteSimilarities }[] = [];
					
					for (const note of noteSimilarities) {
						// Find existing group with similar similarity
						let foundGroup = false;
						for (const group of similarityGroups) {
							if (Math.abs(group.similarity - note.similarity) < similarityTolerance) {
								group.notes.push(note);
								foundGroup = true;
								break;
							}
						}
						if (!foundGroup) {
							similarityGroups.push({ similarity: note.similarity, notes: [note] });
						}
					}
					
					// Sort groups by similarity (highest first)
					similarityGroups.sort((a, b) => b.similarity - a.similarity);
					
					// Calculate center card dimensions for protected zone
					const cardWidth = 400;
					const cardHeight = 150;
					const cardDiagonal = Math.sqrt(cardWidth * cardWidth + cardHeight * cardHeight);
					
					// Minimum spacing between nodes to avoid overlap (much larger)
					const minSpacing = Math.max(nodeWidth, nodeHeight) + 100; // Add 100px padding for more distance
					
					// Calculate radius range: closest notes must be far enough from center card
					const minSimilarity = similarityGroups.length > 0 ? Math.min(...similarityGroups.map(g => g.similarity)) : 0;
					const maxSimilarity = similarityGroups.length > 0 ? Math.max(...similarityGroups.map(g => g.similarity)) : 1;
					const similarityRange = maxSimilarity - minSimilarity || 1;
					
					// Minimum radius must account for center card + spacing
					const centerCardBuffer = Math.max(cardWidth, cardHeight) / 2 + minSpacing;
					const minRadius = Math.max(centerCardBuffer, 300); // At least 300px from center, or more if needed
					const maxRadius = 700; // Increased max radius
					const radiusRange = maxRadius - minRadius;
					
					// Place notes group by group
					for (const group of similarityGroups) {
						// Calculate distance for this similarity level
						const normalizedSimilarity = (group.similarity - minSimilarity) / similarityRange;
						const distanceFromCenter = maxRadius - (normalizedSimilarity * radiusRange);
						
						// Calculate how many notes can fit at this radius without overlap
						const circumference = 2 * Math.PI * distanceFromCenter;
						const maxNotesAtRadius = Math.floor(circumference / minSpacing);
						
						// If we have more notes than can fit, we need to increase radius or spread them
						const numNotes = group.notes.length;
						
						if (numNotes <= maxNotesAtRadius) {
							// All notes fit at this radius, distribute evenly
							const angleStep = (2 * Math.PI) / numNotes;
							
							for (let i = 0; i < numNotes; i++) {
								const angle = i * angleStep;
								const nodeX = centerX + Math.cos(angle) * distanceFromCenter;
								const nodeY = centerY + Math.sin(angle) * distanceFromCenter;
								
								const nodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
								
								const noteNode: CanvasNode = {
									id: nodeId,
									type: 'file',
									file: group.notes[i].notePath,
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
							// Too many notes for this radius, need to spread them out
							// Use a spiral or multiple rings approach
							// For now, we'll create multiple rings at slightly different radii
							const numRings = Math.ceil(numNotes / maxNotesAtRadius);
							const ringSpacing = minSpacing;
							
							for (let ring = 0; ring < numRings; ring++) {
								const ringRadius = distanceFromCenter + (ring * ringSpacing);
								const notesInRing = ring === numRings - 1 
									? numNotes - (ring * maxNotesAtRadius) 
									: maxNotesAtRadius;
								
								const angleStep = (2 * Math.PI) / notesInRing;
								const startAngle = ring * (angleStep / 2); // Offset each ring slightly
								
								for (let i = 0; i < notesInRing; i++) {
									const noteIndex = ring * maxNotesAtRadius + i;
									if (noteIndex >= numNotes) break;
									
									const angle = startAngle + i * angleStep;
									const nodeX = centerX + Math.cos(angle) * ringRadius;
									const nodeY = centerY + Math.sin(angle) * ringRadius;
									
									const nodeId = Array.from({ length: 16 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
									
									const noteNode: CanvasNode = {
										id: nodeId,
										type: 'file',
										file: group.notes[noteIndex].notePath,
										x: Math.round(nodeX - nodeWidth / 2),
										y: Math.round(nodeY - nodeHeight / 2),
										width: nodeWidth,
										height: nodeHeight,
										styleAttributes: {},
									};
									
									canvas.nodes.push(noteNode);
									addedNodes.push(noteNode);
								}
							}
						}
					}
					
					// Get center card node for collision detection
					const centerCardNode = canvas.nodes.find((n: any) => n.type === 'text' && 
						Math.abs(n.x + n.width / 2 - centerX) < 10 && 
						Math.abs(n.y + n.height / 2 - centerY) < 10);
					
					// Final pass: iterative collision detection and resolution to ensure no overlaps
					// Run multiple iterations to handle cascading overlaps
					const maxIterations = 20; // Increased iterations
					for (let iteration = 0; iteration < maxIterations; iteration++) {
						let hasOverlap = false;
						
						// Check overlaps between notes
						for (let i = 0; i < addedNodes.length; i++) {
							const node1 = addedNodes[i];
							const x1 = node1.x + node1.width / 2;
							const y1 = node1.y + node1.height / 2;
							
							// Check overlap with center card
							if (centerCardNode) {
								const cardX = centerCardNode.x + centerCardNode.width / 2;
								const cardY = centerCardNode.y + centerCardNode.height / 2;
								const cardLeft = centerCardNode.x;
								const cardRight = centerCardNode.x + centerCardNode.width;
								const cardTop = centerCardNode.y;
								const cardBottom = centerCardNode.y + centerCardNode.height;
								
								const nodeLeft = node1.x;
								const nodeRight = node1.x + node1.width;
								const nodeTop = node1.y;
								const nodeBottom = node1.y + node1.height;
								
								// Check if node overlaps with card (with buffer)
								const buffer = minSpacing / 2;
								const overlapX = (nodeLeft - buffer < cardRight + buffer) && (nodeRight + buffer > cardLeft - buffer);
								const overlapY = (nodeTop - buffer < cardBottom + buffer) && (nodeBottom + buffer > cardTop - buffer);
								
								if (overlapX && overlapY) {
									hasOverlap = true;
									
									// Push node away from center card
									const dx = x1 - cardX;
									const dy = y1 - cardY;
									const distance = Math.sqrt(dx * dx + dy * dy);
									
									if (distance < minSpacing || distance === 0) {
										// Calculate push direction
										let pushAngle: number;
										if (distance === 0) {
											// If at same position, push in random direction
											pushAngle = Math.random() * 2 * Math.PI;
										} else {
											pushAngle = Math.atan2(dy, dx);
										}
										
										// Calculate how much to push
										const pushDistance = minSpacing - distance + buffer;
										
										// Push node away from center
										const pushX = Math.cos(pushAngle) * pushDistance;
										const pushY = Math.sin(pushAngle) * pushDistance;
										
										node1.x = Math.round(node1.x + pushX);
										node1.y = Math.round(node1.y + pushY);
									}
								}
							}
							
							// Check overlaps with other notes
							for (let j = i + 1; j < addedNodes.length; j++) {
								const node2 = addedNodes[j];
								const x2 = node2.x + node2.width / 2;
								const y2 = node2.y + node2.height / 2;
								
								// Check if nodes overlap (using bounding box with padding)
								const padding = minSpacing / 2; // Larger padding
								const overlapX = (node1.x - padding < node2.x + node2.width + padding) && 
								                (node1.x + node1.width + padding > node2.x - padding);
								const overlapY = (node1.y - padding < node2.y + node2.height + padding) && 
								                (node1.y + node1.height + padding > node2.y - padding);
								
								if (overlapX && overlapY) {
									hasOverlap = true;
									
									// Calculate centers and distance
									const dx = x2 - x1;
									const dy = y2 - y1;
									const distance = Math.sqrt(dx * dx + dy * dy);
									
									// Calculate required separation
									const requiredDistance = minSpacing;
									
									if (distance < requiredDistance || distance === 0) {
										// Nodes are too close or overlapping
										// Calculate push direction
										let pushAngle: number;
										if (distance === 0) {
											// If nodes are at same position, use random angle
											pushAngle = Math.random() * 2 * Math.PI;
										} else {
											pushAngle = Math.atan2(dy, dx);
										}
										
										// Calculate how much to push
										const pushDistance = (requiredDistance - distance) / 2 + padding;
										
										// Push both nodes apart symmetrically
										const pushX = Math.cos(pushAngle) * pushDistance;
										const pushY = Math.sin(pushAngle) * pushDistance;
										
										node1.x = Math.round(node1.x - pushX);
										node1.y = Math.round(node1.y - pushY);
										node2.x = Math.round(node2.x + pushX);
										node2.y = Math.round(node2.y + pushY);
									}
								}
							}
						}
						
						// If no overlaps found, we're done
						if (!hasOverlap) {
							break;
						}
					}
				} else {
					console.warn('[Thoughtlands:CanvasService] Could not generate center embedding, falling back to regular arrangement');
					arrangeBySimilarity = false; // Fall back to regular arrangement
				}
			}
			
			// Regular arrangement (grid layout) if not using similarity arrangement
			if (!arrangeBySimilarity || !this.embeddingService || addedNodes.length === 0) {
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

				// Add each note as a file node (no master card, no connections)
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
				console.log('[Thoughtlands:CanvasService] Creating connections from links');
				const nodeMap = new Map<string, string>(); // Map note path to node ID
				addedNodes.forEach(node => {
					if (node.file) {
						nodeMap.set(node.file, node.id);
					}
				});

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
								// Create edge from source to target
								const edgeId = `edge-${sourceNodeId}-${targetNodeId}-${Date.now()}`;
								const edge: CanvasEdge = {
									id: edgeId,
									fromNode: sourceNodeId,
									fromSide: 'right',
									toNode: targetNodeId,
									toSide: 'left',
									styleAttributes: {}
								};
								canvas.edges.push(edge);
								console.log('[Thoughtlands:CanvasService] Created edge from', notePath, 'to', linkPath);
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

			// Write back to canvas file with proper formatting
			// Obsidian uses tabs for indentation in canvas files
			// Remove any undefined or null values that might cause issues
			const cleanCanvas = {
				nodes: canvas.nodes.filter((n: any) => n != null),
				edges: canvas.edges.filter((e: any) => e != null),
				metadata: canvas.metadata || { version: '1.0-1.0' }
			};
			
			const jsonContent = JSON.stringify(cleanCanvas, null, '\t');
			console.log('[Thoughtlands:CanvasService] Writing canvas file with', cleanCanvas.nodes.length, 'nodes');
			console.log('[Thoughtlands:CanvasService] Canvas structure:', {
				nodesCount: cleanCanvas.nodes.length,
				edgesCount: cleanCanvas.edges.length,
				hasMetadata: !!cleanCanvas.metadata,
				firstNode: cleanCanvas.nodes[0]
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

			// Return the canvas path and whether it was new
			return { path: canvasFile.path, isNew: isNewCanvas };
		} catch (error) {
			console.error('[Thoughtlands:CanvasService] Error adding region to canvas:', error);
			return null;
		}
	}

	getAllCanvasFiles(): TFile[] {
		const allFiles = this.app.vault.getFiles();
		return allFiles.filter(file => file.extension === 'canvas');
	}
}

