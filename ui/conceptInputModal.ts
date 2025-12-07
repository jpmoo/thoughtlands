import { App, Modal } from 'obsidian';

export type ConceptScope = 'narrow' | 'regular' | 'broad';

export interface ConceptInputResult {
	concepts: string[];
	scope: ConceptScope;
}

export class ConceptInputModal extends Modal {
	private conceptsInput: HTMLTextAreaElement;
	private scopeInput: HTMLInputElement[];
	private onSubmit: (result: ConceptInputResult) => void;
	private selectedScope: ConceptScope = 'regular';

	constructor(
		app: App,
		onSubmit: (result: ConceptInputResult) => void
	) {
		super(app);
		this.onSubmit = onSubmit;
		this.scopeInput = [];
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: 'Enter Concept' });

		// Concepts input
		const conceptsLabel = contentEl.createEl('label', { 
			text: 'Describe your concept (a sentence or two):',
			attr: { style: 'display: block; margin: 10px 0 5px 0;' }
		});

		this.conceptsInput = contentEl.createEl('textarea', {
			placeholder: 'e.g., I want to explore how mentorship and belonging create community connections',
			attr: { 
				style: 'width: 100%; margin: 5px 0 15px 0; padding: 5px; min-height: 60px;',
				rows: '3'
			},
		});

		this.conceptsInput.focus();

		// Scope selection
		const scopeLabel = contentEl.createEl('label', { 
			text: 'Scope:',
			attr: { style: 'display: block; margin: 10px 0 5px 0;' }
		});

		const scopeContainer = contentEl.createDiv({ 
			attr: { style: 'margin: 5px 0 15px 0;' } 
		});

		const scopes: { value: ConceptScope; label: string; desc: string }[] = [
			{ value: 'narrow', label: 'Narrow', desc: 'Top 10 tags' },
			{ value: 'regular', label: 'Regular', desc: 'Top 30 tags' },
			{ value: 'broad', label: 'Broad', desc: 'Up to 50 tags' },
		];

		scopes.forEach((scope) => {
			const scopeDiv = scopeContainer.createDiv({ 
				attr: { style: 'margin: 5px 0;' } 
			});

			const radio = scopeDiv.createEl('input', {
				type: 'radio',
				attr: { 
					id: `scope-${scope.value}`,
					name: 'scope',
					value: scope.value,
					style: 'margin-right: 8px;'
				}
			});

			if (scope.value === 'regular') {
				radio.checked = true;
			}

			radio.addEventListener('change', () => {
				if (radio.checked) {
					this.selectedScope = scope.value;
				}
			});

			const label = scopeDiv.createEl('label', {
				text: `${scope.label} (${scope.desc})`,
				attr: { 
					for: `scope-${scope.value}`,
					style: 'cursor: pointer;'
				}
			});

			this.scopeInput.push(radio);
		});

		// Buttons
		const buttonContainer = contentEl.createDiv({ 
			attr: { style: 'text-align: right; margin-top: 10px;' } 
		});
		
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => this.close());

		const submitButton = buttonContainer.createEl('button', { 
			text: 'Continue', 
			attr: { style: 'margin-left: 10px;' } 
		});
		submitButton.addEventListener('click', () => {
			const conceptText = this.conceptsInput.value.trim();

			if (conceptText.length === 0) {
				return;
			}

			// Store as array with single element for backward compatibility
			this.onSubmit({
				concepts: [conceptText],
				scope: this.selectedScope
			});
			this.close();
		});

		this.conceptsInput.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				const conceptText = this.conceptsInput.value.trim();

				if (conceptText.length > 0) {
					this.onSubmit({
						concepts: [conceptText],
						scope: this.selectedScope
					});
					this.close();
				}
			}
			if (e.key === 'Escape') {
				this.close();
			}
		});
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}

