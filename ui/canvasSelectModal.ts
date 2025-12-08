import { App, Modal, TFile, SuggestModal } from 'obsidian';
import { CanvasService } from '../services/canvasService';

export class CanvasSelectModal extends Modal {
	private canvasService: CanvasService;
	private onSubmit: (canvasFile: TFile | null, isNew: boolean, drawConnections: boolean, createCard: boolean, arrangeBySimilarity: boolean) => void;
	private suggestedName: string = '';
	private drawConnections: boolean = false;
	private createCard: boolean = false;
	private arrangeBySimilarity: boolean = false;
	private canArrangeBySimilarity: boolean = false;

	constructor(
		app: App,
		canvasService: CanvasService,
		onSubmit: (canvasFile: TFile | null, isNew: boolean, drawConnections: boolean, createCard: boolean, arrangeBySimilarity: boolean) => void,
		suggestedName: string = '',
		canArrangeBySimilarity: boolean = false
	) {
		super(app);
		this.canvasService = canvasService;
		this.onSubmit = onSubmit;
		// Sanitize suggested name to remove illegal characters
		this.suggestedName = this.sanitizeFileName(suggestedName);
		this.canArrangeBySimilarity = canArrangeBySimilarity;
	}

	private sanitizeFileName(name: string): string {
		if (!name) return '';
		// Remove illegal characters: / \ : * ? " < > |
		let sanitized = name.replace(/[\/\\:*?"<>|]/g, '');
		// Remove leading/trailing spaces and dots
		sanitized = sanitized.replace(/^[\s.]+|[\s.]+$/g, '');
		// Replace multiple spaces with single space
		sanitized = sanitized.replace(/\s+/g, ' ');
		return sanitized;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Select or Create Canvas' });

		// Search/Select existing canvas
		const searchSection = contentEl.createDiv({ 
			attr: { style: 'margin: 15px 0;' } 
		});
		searchSection.createEl('h3', { 
			text: 'Select Existing Canvas',
			attr: { style: 'font-size: 1em; margin-bottom: 10px;' }
		});

		const canvasFiles = this.canvasService.getAllCanvasFiles();
		
		if (canvasFiles.length === 0) {
			searchSection.createEl('p', { 
				text: 'No canvas files found in vault.',
				attr: { style: 'color: var(--text-muted); font-size: 0.9em;' }
			});
		} else {
			const canvasList = searchSection.createDiv({ 
				attr: { 
					style: 'max-height: 200px; overflow-y: auto; border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 5px;' 
				} 
			});

			canvasFiles.forEach(canvasFile => {
				const canvasItem = canvasList.createDiv({ 
					attr: { 
						style: 'padding: 8px; margin: 2px 0; cursor: pointer; border-radius: 4px;',
						class: 'canvas-item'
					} 
				});
				
				canvasItem.createEl('div', { 
					text: canvasFile.basename,
					attr: { style: 'font-weight: 500;' }
				});
				canvasItem.createEl('div', { 
					text: canvasFile.path,
					attr: { style: 'font-size: 0.85em; color: var(--text-muted);' }
				});

				canvasItem.addEventListener('click', () => {
					this.onSubmit(canvasFile, false, this.drawConnections, this.createCard, this.arrangeBySimilarity); // false = existing canvas
					this.close();
				});

				canvasItem.addEventListener('mouseenter', () => {
					canvasItem.style.backgroundColor = 'var(--background-modifier-hover)';
				});
				canvasItem.addEventListener('mouseleave', () => {
					canvasItem.style.backgroundColor = 'transparent';
				});
			});
		}

		// Add option to draw connections from links
		const optionsSection = contentEl.createDiv({ 
			attr: { style: 'margin: 15px 0; padding: 10px; background: var(--background-secondary); border-radius: 4px;' } 
		});
		optionsSection.createEl('h3', { 
			text: 'Options',
			attr: { style: 'font-size: 1em; margin-bottom: 10px; margin-top: 0;' }
		});
		
		const connectionOption = optionsSection.createDiv({ 
			attr: { style: 'display: flex; align-items: center; gap: 10px; flex-wrap: wrap;' }
		});
		
		const checkbox = connectionOption.createEl('input', {
			type: 'checkbox',
			attr: { id: 'draw-connections-checkbox' }
		});
		checkbox.checked = this.drawConnections;
		checkbox.addEventListener('change', (e) => {
			this.drawConnections = (e.target as HTMLInputElement).checked;
		});
		
		const labelContainer = connectionOption.createDiv({ 
			attr: { style: 'display: flex; flex-direction: column; gap: 2px;' }
		});
		labelContainer.createEl('label', {
			text: 'Draw connections from links',
			attr: { 
				for: 'draw-connections-checkbox',
				style: 'cursor: pointer; font-weight: 500;'
			}
		});
		labelContainer.createEl('span', {
			text: '(Creates arrows between notes based on [[links]])',
			attr: { style: 'font-size: 0.85em; color: var(--text-muted);' }
		});

		// Add option to create a card
		const cardOption = optionsSection.createDiv({ 
			attr: { style: 'display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px;' }
		});
		
		const cardCheckbox = cardOption.createEl('input', {
			type: 'checkbox',
			attr: { id: 'create-card-checkbox' }
		});
		cardCheckbox.checked = this.createCard;
		cardCheckbox.addEventListener('change', (e) => {
			this.createCard = (e.target as HTMLInputElement).checked;
		});
		
		const cardLabelContainer = cardOption.createDiv({ 
			attr: { style: 'display: flex; flex-direction: column; gap: 2px;' }
		});
		cardLabelContainer.createEl('label', {
			text: 'Create a card with search/concept text',
			attr: { 
				for: 'create-card-checkbox',
				style: 'cursor: pointer; font-weight: 500;'
			}
		});
		cardLabelContainer.createEl('span', {
			text: '(Adds a text card with your search terms or concept prompt)',
			attr: { style: 'font-size: 0.85em; color: var(--text-muted);' }
		});

		// Add option to arrange by semantic similarity (only if available)
		if (this.canArrangeBySimilarity) {
			const similarityOption = optionsSection.createDiv({ 
				attr: { style: 'display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-top: 10px;' }
			});
			
			const similarityCheckbox = similarityOption.createEl('input', {
				type: 'checkbox',
				attr: { id: 'arrange-by-similarity-checkbox' }
			});
			similarityCheckbox.checked = this.arrangeBySimilarity;
			similarityCheckbox.addEventListener('change', (e) => {
				this.arrangeBySimilarity = (e.target as HTMLInputElement).checked;
			});
			
			const similarityLabelContainer = similarityOption.createDiv({ 
				attr: { style: 'display: flex; flex-direction: column; gap: 2px;' }
			});
			similarityLabelContainer.createEl('label', {
				text: 'Arrange by semantic similarity',
				attr: { 
					for: 'arrange-by-similarity-checkbox',
					style: 'cursor: pointer; font-weight: 500;'
				}
			});
			similarityLabelContainer.createEl('span', {
				text: '(Places notes in a circular cluster with distance reflecting similarity)',
				attr: { style: 'font-size: 0.85em; color: var(--text-muted);' }
			});
		}

		// Create new canvas section (at the bottom)
		const createSection = contentEl.createDiv({ 
			attr: { style: 'margin: 20px 0; padding-top: 20px; border-top: 1px solid var(--background-modifier-border);' } 
		});
		createSection.createEl('h3', { 
			text: 'Create New Canvas',
			attr: { style: 'font-size: 1em; margin-bottom: 10px;' }
		});

		const nameInput = createSection.createEl('input', {
			type: 'text',
			placeholder: 'Canvas name (e.g., My Canvas)',
			value: this.suggestedName,
			attr: { 
				style: 'width: 100%; padding: 8px; margin: 10px 0;',
				id: 'canvas-name-input'
			}
		});

		const createButton = createSection.createEl('button', { 
			text: 'Create New Canvas',
			attr: { style: 'width: 100%; padding: 8px; margin-top: 5px;' }
		});

		createButton.addEventListener('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			
			let canvasName = nameInput.value.trim();
			if (!canvasName) {
				const { Notice } = await import('obsidian');
				new Notice('Please enter a canvas name');
				return;
			}

			// Sanitize canvas name - remove illegal characters
			canvasName = this.sanitizeFileName(canvasName);
			
			if (!canvasName) {
				const { Notice } = await import('obsidian');
				new Notice('Canvas name contains only illegal characters. Please enter a valid name.');
				return;
			}

			// Disable button while creating
			createButton.disabled = true;
			createButton.textContent = 'Creating...';

			try {
				// Use Obsidian's built-in method to get the new file location
				// This respects the user's settings automatically
				let canvasPath = `${canvasName}.canvas`;
				
				try {
					// Try to get the new file location from vault config
					const vaultConfig = (this.app.vault as any).config;
					if (vaultConfig) {
						const newFileLocation = vaultConfig.newFileLocation || 'root';
						const newFileFolderPath = vaultConfig.newFileFolderPath || '';
						
						console.log('[Thoughtlands] Config - newFileLocation:', newFileLocation, 'newFileFolderPath:', newFileFolderPath);
						
						if (newFileLocation === 'folder' && newFileFolderPath) {
							// Use the configured folder path
							canvasPath = `${newFileFolderPath}/${canvasName}.canvas`;
						} else if (newFileLocation === 'folder') {
							// Use current active file's folder
							const activeFile = this.app.workspace.getActiveFile();
							if (activeFile && activeFile.parent) {
								canvasPath = `${activeFile.parent.path}/${canvasName}.canvas`;
							}
						} else if (newFileLocation && newFileLocation !== 'root') {
							// Legacy: specific folder path
							canvasPath = `${newFileLocation}/${canvasName}.canvas`;
						}
					}
				} catch (e) {
					console.log('[Thoughtlands] Could not access vault config:', e);
				}

				console.log('[Thoughtlands] Creating canvas at path:', canvasPath);

				// Create empty canvas file with proper format (tabs for indentation)
				// Match Obsidian's canvas structure
				const canvasData: any = {
					nodes: [],
					edges: [],
					metadata: {
						version: '1.0-1.0'
					}
				};
				const newCanvasFile = await this.app.vault.create(canvasPath, JSON.stringify(canvasData, null, '\t'));
				this.onSubmit(newCanvasFile, true, this.drawConnections, this.createCard, this.arrangeBySimilarity); // true = new canvas
				this.close();
			} catch (error) {
				console.error('[Thoughtlands] Error creating canvas:', error);
				const { Notice } = await import('obsidian');
				new Notice(`Failed to create canvas: ${error instanceof Error ? error.message : 'Unknown error'}`);
				// Re-enable button
				createButton.disabled = false;
				createButton.textContent = 'Create New Canvas';
			}
		});

		nameInput.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				createButton.click();
			}
		});

		// Buttons
		const buttonContainer = contentEl.createDiv({ 
			attr: { style: 'text-align: right; margin-top: 20px;' } 
		});
		
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => {
			this.onSubmit(null, false, false, false, false);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

