import { App, Modal, TFile, SuggestModal } from 'obsidian';
import { CanvasService } from '../services/canvasService';

export class CanvasSelectModal extends Modal {
	private canvasService: CanvasService;
	private onSubmit: (canvasFile: TFile | null, isNew: boolean, drawConnections: boolean) => void;
	private suggestedName: string = '';
	private drawConnections: boolean = false;

	constructor(
		app: App,
		canvasService: CanvasService,
		onSubmit: (canvasFile: TFile | null, isNew: boolean, drawConnections: boolean) => void,
		suggestedName: string = ''
	) {
		super(app);
		this.canvasService = canvasService;
		this.onSubmit = onSubmit;
		this.suggestedName = suggestedName;
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
					this.onSubmit(canvasFile, false, this.drawConnections); // false = existing canvas
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

		// Create new canvas
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

		createButton.addEventListener('click', async () => {
			const canvasName = nameInput.value.trim();
			if (!canvasName) {
				return;
			}

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
				this.onSubmit(newCanvasFile, true, this.drawConnections); // true = new canvas
				this.close();
			} catch (error) {
				console.error('[Thoughtlands] Error creating canvas:', error);
				// Show error - could add a notice here
			}
		});

		nameInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				createButton.click();
			}
		});

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

		// Buttons
		const buttonContainer = contentEl.createDiv({ 
			attr: { style: 'text-align: right; margin-top: 20px;' } 
		});
		
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => {
			this.onSubmit(null, false, false);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

