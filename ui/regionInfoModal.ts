import { App, Modal, TFile } from 'obsidian';
import { Region } from '../models/region';

export class RegionInfoModal extends Modal {
	private region: Region;

	constructor(app: App, region: Region) {
		super(app);
		this.region = region;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		// Header
		const header = contentEl.createDiv({ attr: { style: 'display: flex; align-items: center; margin-bottom: 20px;' } });
		const colorIndicator = header.createDiv({
			attr: {
				style: `width: 20px; height: 20px; background-color: ${this.region.color}; border-radius: 50%; margin-right: 10px;`,
			},
		});
		header.createEl('h2', { text: this.region.name, attr: { style: 'margin: 0;' } });

		// Region metadata
		const metadata = contentEl.createDiv({ attr: { style: 'margin-bottom: 20px; padding: 10px; background: var(--background-secondary); border-radius: 4px;' } });
		metadata.createEl('p', { 
			text: `Mode: ${this.region.mode}`,
			attr: { style: 'margin: 5px 0;' }
		});
		metadata.createEl('p', { 
			text: `Created: ${new Date(this.region.createdAt).toLocaleString()}`,
			attr: { style: 'margin: 5px 0; font-size: 0.9em; color: var(--text-muted);' }
		});
		metadata.createEl('p', { 
			text: `Notes: ${this.region.notes.length}`,
			attr: { style: 'margin: 5px 0;' }
		});
		// Show canvas information
		let canvases = this.region.canvases || [];
		// Backward compatibility: if canvasPath exists but no canvases array, create one
		if (this.region.canvasPath && canvases.length === 0) {
			canvases.push({
				path: this.region.canvasPath,
				addedAt: this.region.updatedAt, // Use updatedAt as fallback
				isNew: false
			});
		}
		
		// Sort canvases by date (most recent first)
		canvases = [...canvases].sort((a, b) => {
			const dateA = new Date(a.addedAt).getTime();
			const dateB = new Date(b.addedAt).getTime();
			return dateB - dateA; // Reverse order (newest first)
		});
		
		if (canvases.length > 0) {
			const canvasSection = metadata.createDiv({ attr: { style: 'margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--background-modifier-border);' } });
			
			// Collapsible header
			const canvasHeader = canvasSection.createDiv({ 
				attr: { 
					style: 'display: flex; align-items: center; cursor: pointer; user-select: none; margin-bottom: 5px;'
				}
			});
			
			// Carat icon (pointing down when open)
			const carat = canvasHeader.createSpan({ 
				text: '▼',
				attr: { 
					style: 'font-size: 0.8em; margin-right: 5px; color: var(--text-muted); transition: transform 0.2s;'
				}
			});
			
			canvasHeader.createEl('strong', { text: `Canvases (${canvases.length}):` });
			
			// Canvas list container (initially visible)
			const canvasList = canvasSection.createDiv({ 
				attr: { 
					style: 'display: block;'
				}
			});
			
			let isExpanded = true;
			
			// Toggle function
			const toggleCanvasList = () => {
				isExpanded = !isExpanded;
				if (isExpanded) {
					canvasList.style.display = 'block';
					carat.textContent = '▼';
				} else {
					canvasList.style.display = 'none';
					carat.textContent = '▶';
				}
			};
			
			canvasHeader.addEventListener('click', toggleCanvasList);
			
			canvases.forEach((canvas, index) => {
				const canvasItem = canvasList.createDiv({ attr: { style: 'margin: 5px 0; padding: 5px; background: var(--background-primary); border-radius: 3px;' } });
				
				// Canvas path link
				const canvasLink = canvasItem.createEl('a', { 
					text: canvas.path,
					attr: { 
						style: 'color: var(--text-accent); cursor: pointer; text-decoration: underline; font-weight: 500;',
						href: '#'
					}
				});
				canvasLink.addEventListener('click', (e) => {
					e.preventDefault();
					this.app.workspace.openLinkText(canvas.path, '', true);
					this.close();
				});
				
				// Status and timestamp
				const statusText = canvas.isNew ? 'new' : 'added';
				const dateTime = new Date(canvas.addedAt).toLocaleString();
				canvasItem.createEl('div', { 
					text: `${statusText} • ${dateTime}`,
					attr: { 
						style: 'font-size: 0.85em; color: var(--text-muted); margin-top: 3px;'
					}
				});
			});
		}

		// Source information based on mode
		const sourceSection = contentEl.createDiv({ attr: { style: 'margin-bottom: 20px;' } });
		sourceSection.createEl('h3', { text: 'Source Information', attr: { style: 'margin-bottom: 10px;' } });

		if (this.region.mode === 'concept' && this.region.source.concepts) {
			const conceptsDiv = sourceSection.createDiv({ attr: { style: 'margin-bottom: 15px;' } });
			conceptsDiv.createEl('strong', { text: 'Concepts Entered:' });
			const conceptsList = conceptsDiv.createEl('ul', { attr: { style: 'margin: 5px 0; padding-left: 20px;' } });
			this.region.source.concepts.forEach(concept => {
				conceptsList.createEl('li', { text: concept });
			});

			// Tags returned by AI (stored when region was created)
			if (this.region.source.tags && this.region.source.tags.length > 0) {
				const tagsDiv = sourceSection.createDiv({ attr: { style: 'margin-bottom: 15px;' } });
				tagsDiv.createEl('strong', { text: 'Tags Returned by AI:' });
				const tagsList = tagsDiv.createEl('ul', { attr: { style: 'margin: 5px 0; padding-left: 20px;' } });
				this.region.source.tags.forEach(tag => {
					tagsList.createEl('li', { text: `#${tag}` });
				});
			}
		} else if (this.region.mode === 'search+tags' && this.region.source.tags) {
			const tagsDiv = sourceSection.createDiv({ attr: { style: 'margin-bottom: 15px;' } });
			tagsDiv.createEl('strong', { text: 'Tags Used:' });
			const tagsList = tagsDiv.createEl('ul', { attr: { style: 'margin: 5px 0; padding-left: 20px;' } });
			this.region.source.tags.forEach(tag => {
				tagsList.createEl('li', { text: `#${tag}` });
			});
		} else if (this.region.mode === 'search') {
			if (this.region.source.query) {
				sourceSection.createEl('p', { 
					text: `Search Query: ${this.region.source.query}`,
					attr: { style: 'margin: 5px 0;' }
				});
			} else {
				sourceSection.createEl('p', { 
					text: 'Search Query: (not available)',
					attr: { style: 'margin: 5px 0; color: var(--text-muted);' }
				});
			}
		}

		// Notes list
		const notesSection = contentEl.createDiv();
		notesSection.createEl('h3', { text: 'Matching Notes', attr: { style: 'margin-bottom: 10px;' } });

		if (this.region.notes.length === 0) {
			notesSection.createEl('p', { 
				text: 'No notes found.',
				attr: { style: 'color: var(--text-muted);' }
			});
		} else {
			const notesList = notesSection.createDiv({ 
				attr: { style: 'max-height: 400px; overflow-y: auto; border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 10px;' } 
			});
			
			this.region.notes.forEach((notePath, index) => {
				const noteItem = notesList.createDiv({ 
					attr: { 
						style: 'padding: 5px; margin-bottom: 5px; border-bottom: 1px solid var(--background-modifier-border); cursor: pointer;' 
					} 
				});
				
				// Make note clickable to open it
				noteItem.style.cursor = 'pointer';
				noteItem.addEventListener('click', () => {
					const file = this.app.vault.getAbstractFileByPath(notePath);
					if (file instanceof TFile) {
						this.app.workspace.openLinkText(notePath, '', true);
						this.close();
					}
				});
				
				noteItem.addEventListener('mouseenter', () => {
					noteItem.style.backgroundColor = 'var(--background-modifier-hover)';
				});
				noteItem.addEventListener('mouseleave', () => {
					noteItem.style.backgroundColor = 'transparent';
				});

				noteItem.createEl('span', { 
					text: notePath,
					attr: { style: 'font-family: monospace; font-size: 0.9em;' }
				});
			});
		}

		// Close button
		const buttonContainer = contentEl.createDiv({ attr: { style: 'text-align: right; margin-top: 20px;' } });
		const closeButton = buttonContainer.createEl('button', { text: 'Close' });
		closeButton.addEventListener('click', () => this.close());
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

