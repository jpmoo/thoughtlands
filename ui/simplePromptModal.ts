import { App, Modal } from 'obsidian';

export class SimplePromptModal extends Modal {
	private inputEl: HTMLInputElement;
	private onSubmit: (result: string) => void;
	private placeholder: string;
	private title: string;
	private initialValue: string;

	constructor(
		app: App,
		title: string,
		placeholder: string,
		onSubmit: (result: string) => void,
		initialValue: string = ''
	) {
		super(app);
		this.title = title;
		this.placeholder = placeholder;
		this.onSubmit = onSubmit;
		this.initialValue = initialValue;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		contentEl.createEl('h2', { text: this.title });

		this.inputEl = contentEl.createEl('input', {
			type: 'text',
			placeholder: this.placeholder,
			value: this.initialValue,
			attr: { style: 'width: 100%; margin: 10px 0; padding: 5px;' },
		});

		this.inputEl.focus();
		if (this.initialValue) {
			this.inputEl.select();
		}

		const buttonContainer = contentEl.createDiv({ attr: { style: 'text-align: right; margin-top: 10px;' } });
		
		const cancelButton = buttonContainer.createEl('button', { text: 'Cancel' });
		cancelButton.addEventListener('click', () => this.close());

		const submitButton = buttonContainer.createEl('button', { text: 'OK', attr: { style: 'margin-left: 10px;' } });
		submitButton.addEventListener('click', () => {
			this.onSubmit(this.inputEl.value);
			this.close();
		});

		this.inputEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter') {
				this.onSubmit(this.inputEl.value);
				this.close();
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

