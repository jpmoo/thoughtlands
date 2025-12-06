import { ItemView, WorkspaceLeaf } from 'obsidian';
import { Region } from '../models/region';
import { RegionService } from '../services/regionService';
import { CompanionAppService } from '../services/companionAppService';

export const THOUGHTLANDS_VIEW_TYPE = 'thoughtlands-sidebar';

export class ThoughtlandsSidebarView extends ItemView {
	private regionService: RegionService;
	private companionAppService: CompanionAppService;
	private onRegionUpdate: () => void;

	constructor(
		leaf: WorkspaceLeaf,
		regionService: RegionService,
		companionAppService: CompanionAppService,
		onRegionUpdate: () => void
	) {
		super(leaf);
		this.regionService = regionService;
		this.companionAppService = companionAppService;
		this.onRegionUpdate = onRegionUpdate;
	}

	getViewType() {
		return THOUGHTLANDS_VIEW_TYPE;
	}

	getDisplayText() {
		return 'Thoughtlands';
	}

	getIcon() {
		return 'map';
	}

	async onOpen() {
		this.render();
	}

	async onClose() {
		// Cleanup if needed
	}

	render() {
		const { containerEl } = this;
		containerEl.empty();

		const header = containerEl.createDiv({ attr: { style: 'padding: 10px; border-bottom: 1px solid var(--background-modifier-border);' } });
		header.createEl('h2', { text: 'Thoughtlands Regions' });

		const regions = this.regionService.getRegions();

		if (regions.length === 0) {
			const emptyState = containerEl.createDiv({ 
				attr: { style: 'padding: 20px; text-align: center; color: var(--text-muted);' } 
			});
			emptyState.createEl('p', { text: 'No regions created yet.' });
			emptyState.createEl('p', { 
				text: 'Use commands to create regions from search results, tags, or AI concepts.',
				attr: { style: 'font-size: 0.9em; margin-top: 10px;' }
			});
			return;
		}

		const regionsList = containerEl.createDiv({ attr: { style: 'padding: 10px;' } });

		regions.forEach(region => {
			const regionCard = regionsList.createDiv({
				attr: {
					style: 'border: 1px solid var(--background-modifier-border); border-radius: 4px; padding: 10px; margin-bottom: 10px;',
				},
			});

			// Region header with color indicator
			const header = regionCard.createDiv({ attr: { style: 'display: flex; align-items: center; margin-bottom: 8px;' } });
			const colorIndicator = header.createDiv({
				attr: {
					style: `width: 16px; height: 16px; background-color: ${region.color}; border-radius: 50%; margin-right: 8px;`,
				},
			});
			header.createEl('strong', { text: region.name });

			// Region info
			const info = regionCard.createDiv({ attr: { style: 'font-size: 0.9em; color: var(--text-muted); margin-bottom: 8px;' } });
			info.createEl('span', { text: `Mode: ${region.mode} • ` });
			info.createEl('span', { text: `${region.notes.length} notes` });

			// Action buttons
			const actions = regionCard.createDiv({ attr: { style: 'display: flex; gap: 5px; margin-top: 8px;' } });
			
			const renameButton = actions.createEl('button', { text: 'Rename', attr: { style: 'flex: 1;' } });
			renameButton.addEventListener('click', () => this.renameRegion(region));

			const deleteButton = actions.createEl('button', { text: 'Delete', attr: { style: 'flex: 1;' } });
			deleteButton.addEventListener('click', () => this.deleteRegion(region));

			const openButton = actions.createEl('button', { text: 'Open in App', attr: { style: 'flex: 1;' } });
			openButton.addEventListener('click', () => this.openInCompanionApp(region));
		});
	}

	private async renameRegion(region: Region) {
		const newName = prompt('Enter new name:', region.name);
		if (newName && newName.trim() !== '') {
			this.regionService.updateRegion(region.id, { name: newName.trim() });
			this.onRegionUpdate();
			this.render();
		}
	}

	private async deleteRegion(region: Region) {
		if (confirm(`Delete region "${region.name}"?`)) {
			this.regionService.deleteRegion(region.id);
			this.onRegionUpdate();
			this.render();
		}
	}

	private async openInCompanionApp(region: Region) {
		if (this.companionAppService.isReady()) {
			const response = await this.companionAppService.sendRequest('/regions/open', 'POST', { regionId: region.id });
			if (response.success) {
				// Success notification could be added here
			} else {
				// Error notification
			}
		} else {
			// Show error that companion app is not connected
		}
	}
}

