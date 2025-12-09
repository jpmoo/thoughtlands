import { App, Modal } from 'obsidian';
import { ColorPickerModal } from './colorPickerModal';

export interface CardInput {
	text: string;
	color: string;
	drawEdges?: boolean;
}

export class CardInputModal extends Modal {
	private defaultText: string;
	private defaultColors: string[];
	private onSubmit: (result: CardInput | null) => void;
	private selectedColor: string;
	private drawEdges: boolean = false;

	constructor(
		app: App,
		defaultText: string,
		defaultColors: string[],
		onSubmit: (result: CardInput | null) => void
	) {
		super(app);
		this.defaultText = defaultText;
		this.defaultColors = defaultColors;
		this.selectedColor = defaultColors[0] || '#E67E22';
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Canvas Options' });

		// Text input
		const textSection = contentEl.createDiv({ attr: { style: 'margin: 15px 0;' } });
		textSection.createEl('label', { 
			text: 'Card Text:', 
			attr: { style: 'display: block; margin-bottom: 5px; font-weight: 500;' } 
		});
		
		const textInput = textSection.createEl('textarea', {
			text: this.defaultText,
			attr: { 
				style: 'width: 100%; min-height: 80px; padding: 8px; font-family: inherit;',
				placeholder: 'Enter text for the card...'
			}
		});
		textInput.value = this.defaultText;

		// Color selection
		const colorSection = contentEl.createDiv({ attr: { style: 'margin: 15px 0;' } });
		colorSection.createEl('label', { 
			text: 'Card Color:', 
			attr: { style: 'display: block; margin-bottom: 5px; font-weight: 500;' } 
		});

		// Color preview
		const colorPreview = colorSection.createDiv({
			attr: {
				style: `width: 100%; height: 40px; background-color: ${this.selectedColor}; border: 2px solid var(--background-modifier-border); border-radius: 4px; margin-bottom: 10px; cursor: pointer;`,
				title: 'Click to change color'
			}
		});

		// Obsidian canvas default palette colors (as hex equivalents)
		// These are the standard Obsidian canvas colors that work well
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

		// Default color buttons
		const colorGrid = colorSection.createDiv({ 
			attr: { style: 'display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 10px;' } 
		});
		
		allColors.forEach(color => {
			const colorButton = colorGrid.createEl('button', {
				text: '',
				attr: {
					style: `width: 40px; height: 40px; background-color: ${color}; border: 2px solid var(--background-modifier-border); border-radius: 4px; cursor: pointer;`,
					title: color
				},
			});
			colorButton.addEventListener('click', () => {
				this.selectedColor = color;
				colorPreview.setAttribute('style', `width: 100%; height: 40px; background-color: ${color}; border: 2px solid var(--background-modifier-border); border-radius: 4px; margin-bottom: 10px; cursor: pointer;`);
				colorInput.value = color;
			});
		});

		// Custom color input
		const customColorContainer = colorSection.createDiv({ attr: { style: 'margin-top: 10px;' } });
		customColorContainer.createEl('label', { 
			text: 'Custom color (hex):', 
			attr: { style: 'display: block; margin-bottom: 5px; font-size: 0.9em;' } 
		});
		
		const colorInput = customColorContainer.createEl('input', {
			type: 'text',
			placeholder: '#E67E22',
			value: this.selectedColor,
			attr: { style: 'width: 100px; padding: 5px;' },
		});

		colorInput.addEventListener('input', (e) => {
			const value = (e.target as HTMLInputElement).value;
			if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
				this.selectedColor = value;
				colorPreview.setAttribute('style', `width: 100%; height: 40px; background-color: ${value}; border: 2px solid var(--background-modifier-border); border-radius: 4px; margin-bottom: 10px; cursor: pointer;`);
			}
		});

		// Open color picker on preview click
		colorPreview.addEventListener('click', () => {
			const colorModal = new ColorPickerModal(
				this.app,
				this.defaultColors,
				(color: string) => {
					this.selectedColor = color;
					colorPreview.setAttribute('style', `width: 100%; height: 40px; background-color: ${color}; border: 2px solid var(--background-modifier-border); border-radius: 4px; margin-bottom: 10px; cursor: pointer;`);
					colorInput.value = color;
				}
			);
			colorModal.open();
		});

		// Draw edges checkbox (after color section)
		const edgesOption = colorSection.createDiv({ 
			attr: { style: 'display: flex; align-items: center; gap: 8px; margin-top: 10px;' }
		});
		
		const checkbox = edgesOption.createEl('input', {
			type: 'checkbox',
			attr: { id: 'draw-edges-checkbox' }
		});
		checkbox.checked = this.drawEdges;
		checkbox.addEventListener('change', (e) => {
			this.drawEdges = (e.target as HTMLInputElement).checked;
		});
		
		edgesOption.createEl('label', {
			text: 'Draw edges from links',
			attr: { 
				for: 'draw-edges-checkbox',
				style: 'cursor: pointer; font-size: 0.9em;'
			}
		});

		// Buttons
		const buttonContainer = contentEl.createDiv({ 
			attr: { style: 'text-align: right; margin-top: 20px;' } 
		});
		
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => {
			this.onSubmit(null);
			this.close();
		});

		const submitButton = buttonContainer.createEl('button', { 
			text: 'OK', 
			attr: { style: 'margin-left: 10px;' } 
		});
		submitButton.addEventListener('click', () => {
			const text = textInput.value.trim();
			if (text) {
				this.onSubmit({
					text: text,
					color: this.selectedColor,
					drawEdges: this.drawEdges
				});
				this.close();
			}
		});

		// Allow Enter to submit (Ctrl+Enter or Cmd+Enter)
		textInput.addEventListener('keydown', (e) => {
			if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
				submitButton.click();
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

