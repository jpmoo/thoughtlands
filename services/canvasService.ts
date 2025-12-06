import { App, TFile } from 'obsidian';
import { Region } from '../models/region';

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

	constructor(app: App) {
		this.app = app;
	}

	async addRegionToCanvas(canvasFile: TFile, region: Region, isNewCanvas: boolean = false, drawConnections: boolean = false): Promise<{ path: string; isNew: boolean } | null> {
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
			let currentX = existingNodes.length > 0 ? maxX + 400 : 100;
			let currentY = existingNodes.length > 0 ? 200 : 100;
			const nodeWidth = 280; // Smaller width to fit more per row
			const nodeHeight = 200;
			const spacing = 25; // Reduced spacing to fit more per row

			// Add each note as a file node (no master card, no connections)
			let rowCount = 0;
			const nodesPerRow = 8; // More notes per row for wider layout
			const addedNodes: CanvasNode[] = [];

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

