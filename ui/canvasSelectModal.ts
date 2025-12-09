import { App, Modal, TFile, SuggestModal } from 'obsidian';
import { CanvasService } from '../services/canvasService';
import { ColorPickerModal } from './colorPickerModal';

export interface CardInput {
	text: string;
	color: string;
	clustering?: number;
	crowdLayout?: 'regiment' | 'gaggle';
}

export class CanvasSelectModal extends Modal {
	private canvasService: CanvasService;
	private onSubmit: (canvasFile: TFile | null, isNew: boolean, drawConnections: boolean, card?: CardInput | null) => void;
	private suggestedName: string = '';
	private drawConnections: boolean = false;
	private defaultCardText: string = '';
	private defaultColors: string[] = [];
	private cardText: string = '';
	private cardColor: string = '';
	private clustering: number = 50; // 25-100, default 50 (moderate clustering)
	private showLayoutControls: boolean = false;
	private semanticMode?: 'walkabout' | 'hopscotch' | 'rolling-path' | 'crowd';
	private crowdLayout: 'regiment' | 'gaggle' = 'regiment';

	constructor(
		app: App,
		canvasService: CanvasService,
		onSubmit: (canvasFile: TFile | null, isNew: boolean, drawConnections: boolean, card?: CardInput | null) => void,
		suggestedName: string = '',
		defaultCardText: string = '',
		defaultColors: string[] = [],
		showLayoutControls: boolean = false,
		semanticMode?: 'walkabout' | 'hopscotch' | 'rolling-path' | 'crowd'
	) {
		super(app);
		this.canvasService = canvasService;
		this.onSubmit = onSubmit;
		// Sanitize suggested name to remove illegal characters
		this.suggestedName = this.sanitizeFileName(suggestedName);
		this.defaultCardText = defaultCardText;
		this.defaultColors = defaultColors;
		this.cardText = defaultCardText;
		this.cardColor = defaultColors[0] || '#E67E22';
		this.showLayoutControls = showLayoutControls;
		this.semanticMode = semanticMode;
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
					style: 'max-height: 120px; overflow-y: auto; border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 5px;' 
				} 
			});

			canvasFiles.forEach(canvasFile => {
				const canvasItem = canvasList.createDiv({ 
					attr: { 
						style: 'padding: 5px; margin: 2px 0; cursor: pointer; border-radius: 4px;',
						class: 'canvas-item'
					} 
				});
				
				canvasItem.createEl('div', { 
					text: canvasFile.basename,
					attr: { style: 'font-weight: 500; font-size: 0.9em;' }
				});
				canvasItem.createEl('div', { 
					text: canvasFile.path,
					attr: { style: 'font-size: 0.75em; color: var(--text-muted);' }
				});

				canvasItem.addEventListener('click', () => {
					this.onSubmit(canvasFile, false, this.drawConnections, null); // false = existing canvas, null = no card
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



		// Create new canvas section (at the bottom)
		const createSection = contentEl.createDiv({ 
			attr: { style: 'margin: 20px 0; padding-top: 20px; border-top: 1px solid var(--background-modifier-border);' } 
		});
		createSection.createEl('h3', { 
			text: 'Create New Canvas',
			attr: { style: 'font-size: 1em; margin-bottom: 10px;' }
		});

		const nameInput = createSection.createDiv({ 
			attr: { style: 'margin-bottom: 12px;' } 
		});
		nameInput.createEl('label', { 
			text: 'Canvas Name:', 
			attr: { style: 'display: block; margin-bottom: 5px; font-weight: 500;' } 
		});
		const nameInputField = nameInput.createEl('input', {
			type: 'text',
			placeholder: 'Canvas name (e.g., My Canvas)',
			value: this.suggestedName,
			attr: { 
				style: 'width: 100%; padding: 8px;',
				id: 'canvas-name-input'
			}
		});

		// Card text input
		const cardTextSection = createSection.createDiv({ 
			attr: { style: 'margin-bottom: 12px;' } 
		});
		cardTextSection.createEl('label', { 
			text: 'Card Text:', 
			attr: { style: 'display: block; margin-bottom: 5px; font-weight: 500;' } 
		});
		const cardTextInput = cardTextSection.createEl('textarea', {
			text: this.cardText,
			attr: { 
				style: 'width: 100%; min-height: 50px; padding: 8px; font-family: inherit; resize: vertical;',
				placeholder: 'Enter text for the card...'
			}
		});
		cardTextInput.value = this.cardText;
		cardTextInput.addEventListener('input', (e) => {
			this.cardText = (e.target as HTMLTextAreaElement).value;
		});

		// Card color selection
		const cardColorSection = createSection.createDiv({ 
			attr: { style: 'margin-bottom: 12px;' } 
		});
		cardColorSection.createEl('label', { 
			text: 'Card Color:', 
			attr: { style: 'display: block; margin-bottom: 5px; font-weight: 500;' } 
		});

		// Color preview
		const colorPreview = cardColorSection.createDiv({
			attr: {
				style: `width: 100%; height: 30px; background-color: ${this.cardColor}; border: 2px solid var(--background-modifier-border); border-radius: 4px; margin-bottom: 8px; cursor: pointer;`,
				title: 'Click to change color'
			}
		});

		// Obsidian canvas default palette colors (as hex equivalents)
		const obsidianCanvasColors = [
			'#E67E22', // Orange (palette 1)
			'#3498DB', // Blue (palette 2)
			'#2ECC71', // Green (palette 3)
			'#9B59B6', // Purple (palette 4)
			'#E74C3C', // Red (palette 5)
			'#F39C12', // Yellow/Orange (palette 6)
		];
		
		// Combine Obsidian defaults with user's custom colors
		const allColors = [...obsidianCanvasColors, ...this.defaultColors.filter(c => !obsidianCanvasColors.includes(c))];

		// Color buttons
		const colorGrid = cardColorSection.createDiv({ 
			attr: { style: 'display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 8px;' } 
		});
		
		allColors.forEach(color => {
			const colorButton = colorGrid.createEl('button', {
				text: '',
				attr: {
					style: `width: 30px; height: 30px; background-color: ${color}; border: 2px solid var(--background-modifier-border); border-radius: 4px; cursor: pointer;`,
					title: color
				},
			});
			colorButton.addEventListener('click', () => {
				this.cardColor = color;
				colorPreview.setAttribute('style', `width: 100%; height: 30px; background-color: ${color}; border: 2px solid var(--background-modifier-border); border-radius: 4px; margin-bottom: 8px; cursor: pointer;`);
				colorInput.value = color;
			});
		});

		// Custom color input
		const customColorContainer = cardColorSection.createDiv({ attr: { style: 'margin-top: 10px;' } });
		customColorContainer.createEl('label', { 
			text: 'Custom color (hex):', 
			attr: { style: 'display: block; margin-bottom: 5px; font-size: 0.9em;' } 
		});
		
		const colorInput = customColorContainer.createEl('input', {
			type: 'text',
			placeholder: '#E67E22',
			value: this.cardColor,
			attr: { style: 'width: 100px; padding: 5px;' },
		});

		colorInput.addEventListener('input', (e) => {
			const value = (e.target as HTMLInputElement).value;
			if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
				this.cardColor = value;
				colorPreview.setAttribute('style', `width: 100%; height: 30px; background-color: ${value}; border: 2px solid var(--background-modifier-border); border-radius: 4px; margin-bottom: 8px; cursor: pointer;`);
			}
		});

		// Open color picker on preview click
		colorPreview.addEventListener('click', () => {
			const colorModal = new ColorPickerModal(
				this.app,
				this.defaultColors,
				(color: string) => {
					this.cardColor = color;
					colorPreview.setAttribute('style', `width: 100%; height: 30px; background-color: ${color}; border: 2px solid var(--background-modifier-border); border-radius: 4px; margin-bottom: 8px; cursor: pointer;`);
					colorInput.value = color;
				}
			);
			colorModal.open();
		});

		// Draw edges checkbox (after color section)
		const edgesOption = cardColorSection.createDiv({ 
			attr: { style: 'display: flex; align-items: center; gap: 8px; margin-top: 10px;' }
		});
		
		const checkbox = edgesOption.createEl('input', {
			type: 'checkbox',
			attr: { id: 'draw-edges-checkbox' }
		});
		checkbox.checked = this.drawConnections;
		checkbox.addEventListener('change', (e) => {
			this.drawConnections = (e.target as HTMLInputElement).checked;
		});
		
		edgesOption.createEl('label', {
			text: 'Draw edges from links',
			attr: { 
				for: 'draw-edges-checkbox',
				style: 'cursor: pointer; font-size: 0.9em;'
			}
		});

		// Layout controls (only for walkabout mode)
		if (this.showLayoutControls) {
			// Clustering slider with 5 steps (1-5)
			const clusteringSection = createSection.createDiv({ 
				attr: { style: 'margin-bottom: 12px;' } 
			});
			clusteringSection.createEl('label', { 
				text: 'Clustering of semantically similar notes:',
				attr: { style: 'display: block; margin-bottom: 5px; font-weight: 500;' } 
			});
			
			const clusteringContainer = clusteringSection.createDiv({ 
				attr: { style: 'display: flex; align-items: center; gap: 10px;' } 
			});
			
			// Convert 25-100 to 1-4 for display, but store as 25-100 internally
			// Map: 25->1, 50->2, 75->3, 100->4
			const clusteringLevel = Math.min(4, Math.max(1, Math.floor((this.clustering - 25) / 25) + 1));
			
			const clusteringSlider = clusteringContainer.createEl('input', {
				type: 'range',
				attr: { 
					style: 'flex: 1;',
					min: '1',
					max: '4',
					step: '1',
					value: String(clusteringLevel)
				}
			});
			
			const clusteringValue = clusteringContainer.createEl('span', {
				text: String(clusteringLevel),
				attr: { 
					style: 'min-width: 45px; text-align: right; font-weight: 500;' 
				}
			});
			
			// Convert 1-4 back to 25-100 for storage
			clusteringSlider.addEventListener('input', (e: Event) => {
				const level = parseInt((e.target as HTMLInputElement).value);
				this.clustering = 25 + (level - 1) * 25; // 1->25, 2->50, 3->75, 4->100
				clusteringValue.textContent = String(level);
			});
			
			clusteringSection.createEl('div', {
				text: 'Higher = Similar notes cluster more tightly, different notes spread out more',
				attr: { style: 'font-size: 0.85em; color: var(--text-muted); margin-top: 5px;' }
			});
			clusteringSection.createEl('div', {
				text: 'With cluster summary cards at highest level.',
				attr: { style: 'font-size: 0.85em; color: var(--text-muted); margin-top: 3px; font-style: italic;' }
			});
		}

		// Crowd layout option (only for crowd mode)
		if (this.semanticMode === 'crowd') {
			const crowdLayoutSection = createSection.createDiv({ 
				attr: { style: 'margin-bottom: 12px;' } 
			});
			crowdLayoutSection.createEl('label', { 
				text: 'Crowd Layout:',
				attr: { style: 'display: block; margin-bottom: 5px; font-weight: 500;' } 
			});
			
			const regimentRadio = crowdLayoutSection.createEl('input', {
				type: 'radio',
				attr: { 
					name: 'crowd-layout',
					value: 'regiment'
				}
			});
			if (this.crowdLayout === 'regiment') {
				regimentRadio.checked = true;
			}
			regimentRadio.addEventListener('change', () => {
				if (regimentRadio.checked) {
					this.crowdLayout = 'regiment';
					console.log('[Thoughtlands:CanvasSelectModal] Selected regiment layout');
				}
			});
			regimentRadio.id = 'crowd-layout-regiment';
			const regimentLabel = crowdLayoutSection.createEl('label', {
				text: 'Regiment',
				attr: { 
					style: 'margin-left: 5px; cursor: pointer;',
					for: 'crowd-layout-regiment'
				}
			});
			// Also handle label click to ensure selection works
			regimentLabel.addEventListener('click', () => {
				regimentRadio.checked = true;
				this.crowdLayout = 'regiment';
				console.log('[Thoughtlands:CanvasSelectModal] Selected regiment layout via label click');
			});
			crowdLayoutSection.createEl('div', {
				text: 'Uniform grid arrangement',
				attr: { style: 'font-size: 0.85em; color: var(--text-muted); margin-left: 25px; margin-top: 2px; margin-bottom: 8px;' }
			});
			
			const gaggleRadio = crowdLayoutSection.createEl('input', {
				type: 'radio',
				attr: { 
					name: 'crowd-layout',
					value: 'gaggle'
				}
			});
			if (this.crowdLayout === 'gaggle') {
				gaggleRadio.checked = true;
			}
			gaggleRadio.addEventListener('change', () => {
				if (gaggleRadio.checked) {
					this.crowdLayout = 'gaggle';
					console.log('[Thoughtlands:CanvasSelectModal] Selected gaggle layout');
				}
			});
			gaggleRadio.id = 'crowd-layout-gaggle';
			const gaggleLabel = crowdLayoutSection.createEl('label', {
				text: 'Gaggle',
				attr: { 
					style: 'margin-left: 5px; cursor: pointer;',
					for: 'crowd-layout-gaggle'
				}
			});
			// Also handle label click to ensure selection works
			gaggleLabel.addEventListener('click', () => {
				gaggleRadio.checked = true;
				this.crowdLayout = 'gaggle';
				console.log('[Thoughtlands:CanvasSelectModal] Selected gaggle layout via label click');
			});
			crowdLayoutSection.createEl('div', {
				text: 'Random spread - tight but not overlapping, not uniform',
				attr: { style: 'font-size: 0.85em; color: var(--text-muted); margin-left: 25px; margin-top: 2px;' }
			});
		}

		const createButton = createSection.createEl('button', { 
			text: 'Create New Canvas',
			attr: { style: 'width: 100%; padding: 8px; margin-top: 5px;' }
		});

		createButton.addEventListener('click', async (e) => {
			e.preventDefault();
			e.stopPropagation();
			
			let canvasName = nameInputField.value.trim();
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
				let basePath = '';
				let baseName = canvasName;
				
				try {
					// Try to get the new file location from vault config
					const vaultConfig = (this.app.vault as any).config;
					if (vaultConfig) {
						const newFileLocation = vaultConfig.newFileLocation || 'root';
						const newFileFolderPath = vaultConfig.newFileFolderPath || '';
						
						console.log('[Thoughtlands] Config - newFileLocation:', newFileLocation, 'newFileFolderPath:', newFileFolderPath);
						
						if (newFileLocation === 'folder' && newFileFolderPath) {
							// Use the configured folder path
							basePath = newFileFolderPath;
						} else if (newFileLocation === 'folder') {
							// Use current active file's folder
							const activeFile = this.app.workspace.getActiveFile();
							if (activeFile && activeFile.parent) {
								basePath = activeFile.parent.path;
							}
						} else if (newFileLocation && newFileLocation !== 'root') {
							// Legacy: specific folder path
							basePath = newFileLocation;
						}
					}
				} catch (e) {
					console.log('[Thoughtlands] Could not access vault config:', e);
				}

				// Find a unique filename by appending numbers if needed
				// Start by checking the base name
				let canvasPath = basePath ? `${basePath}/${baseName}.canvas` : `${baseName}.canvas`;
				let counter = 1;
				let finalName = baseName;
				
				// Keep iterating until we find an available name
				while (this.app.vault.getAbstractFileByPath(canvasPath)) {
					// File exists, try with number appended
					finalName = `${baseName} ${counter}`;
					canvasPath = basePath ? `${basePath}/${finalName}.canvas` : `${finalName}.canvas`;
					counter++;
					
					// Safety check to prevent infinite loop (though unlikely to reach this)
					if (counter > 1000) {
						const { Notice } = await import('obsidian');
						new Notice('Too many existing canvas files with similar names. Please use a different name.');
						createButton.disabled = false;
						createButton.textContent = 'Create New Canvas';
						return;
					}
				}

				// Verify the final name is actually available (double-check)
				if (this.app.vault.getAbstractFileByPath(canvasPath)) {
					const { Notice } = await import('obsidian');
					new Notice('Error: Could not find an available canvas name. Please try a different name.');
					createButton.disabled = false;
					createButton.textContent = 'Create New Canvas';
					return;
				}

				// Update the input field with the final name (with number if appended)
				// This shows the user what name will be used, and if they create another canvas,
				// they'll see the next number pre-populated
				// Update synchronously before async operation - use multiple methods to ensure it updates
				if (finalName !== baseName) {
					nameInputField.value = finalName;
					// Force update using multiple methods
					nameInputField.setAttribute('value', finalName);
					nameInputField.dispatchEvent(new Event('input', { bubbles: true }));
					nameInputField.dispatchEvent(new Event('change', { bubbles: true }));
					// Also try focusing and selecting to make it visible
					nameInputField.focus();
					nameInputField.select();
				}

				console.log('[Thoughtlands] Creating canvas at path:', canvasPath);
				console.log('[Thoughtlands] Final canvas name:', finalName);
				console.log('[Thoughtlands] Input field value after update:', nameInputField.value);

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
				
				// Create card input if text is provided
				const cardInput: CardInput | null = this.cardText.trim() 
					? { 
						text: this.cardText.trim(), 
						color: this.cardColor,
						clustering: this.showLayoutControls ? this.clustering : undefined,
						crowdLayout: this.semanticMode === 'crowd' ? this.crowdLayout : undefined
					}
					: this.showLayoutControls
						? {
							text: '', 
							color: this.cardColor,
							clustering: this.clustering,
							crowdLayout: this.semanticMode === 'crowd' ? this.crowdLayout : undefined
						}
						: null;
				
				console.log('[Thoughtlands:CanvasSelectModal] Submitting - semanticMode:', this.semanticMode, 'crowdLayout:', this.crowdLayout, 'cardInput:', JSON.stringify(cardInput));
				this.onSubmit(newCanvasFile, true, this.drawConnections, cardInput); // true = new canvas
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

		nameInputField.addEventListener('keydown', async (e) => {
			if (e.key === 'Enter' && !e.shiftKey) {
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
			this.onSubmit(null, false, false, null);
			this.close();
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

