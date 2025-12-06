import { App, Modal } from 'obsidian';

export class ColorPickerModal extends Modal {
	private selectedColor: string;
	private defaultColors: string[];
	private onSubmit: (result: string) => void;

	constructor(
		app: App,
		defaultColors: string[],
		onSubmit: (result: string) => void
	) {
		super(app);
		this.defaultColors = defaultColors;
		this.selectedColor = defaultColors[0] || '#E67E22';
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Select Color' });

		// Default color buttons
		const colorGrid = contentEl.createDiv({ attr: { style: 'display: flex; flex-wrap: wrap; gap: 10px; margin: 10px 0;' } });
		
		this.defaultColors.forEach(color => {
			const colorButton = colorGrid.createEl('button', {
				text: '',
				attr: {
					style: `width: 40px; height: 40px; background-color: ${color}; border: 2px solid var(--background-modifier-border); border-radius: 4px; cursor: pointer;`,
				},
			});
			colorButton.addEventListener('click', () => {
				this.selectedColor = color;
				this.onSubmit(color);
				this.close();
			});
		});

		// Custom color input
		const customContainer = contentEl.createDiv({ attr: { style: 'margin: 10px 0;' } });
		customContainer.createEl('label', { text: 'Custom color (hex):', attr: { style: 'display: block; margin-bottom: 5px;' } });
		
		const colorInput = customContainer.createEl('input', {
			type: 'text',
			placeholder: '#E67E22',
			value: this.selectedColor,
			attr: { style: 'width: 100px; padding: 5px;' },
		});

		const preview = customContainer.createEl('div', {
			attr: {
				style: `width: 40px; height: 40px; background-color: ${this.selectedColor}; border: 1px solid var(--background-modifier-border); border-radius: 4px; margin-top: 5px;`,
			},
		});

		colorInput.addEventListener('input', (e) => {
			const value = (e.target as HTMLInputElement).value;
			if (/^#[0-9A-Fa-f]{6}$/.test(value)) {
				this.selectedColor = value;
				preview.setAttribute('style', `width: 40px; height: 40px; background-color: ${value}; border: 1px solid var(--background-modifier-border); border-radius: 4px; margin-top: 5px;`);
			}
		});

		const buttonContainer = contentEl.createDiv({ attr: { style: 'text-align: right; margin-top: 10px;' } });
		
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => this.close());

		const submitButton = buttonContainer.createEl('button', { text: 'Use Custom', attr: { style: 'margin-left: 10px;' } });
		submitButton.addEventListener('click', () => {
			if (/^#[0-9A-Fa-f]{6}$/.test(colorInput.value)) {
				this.onSubmit(colorInput.value);
				this.close();
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

