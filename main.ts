import { App, Plugin, PluginSettingTab, Setting, Notice } from 'obsidian';
import { CompanionAppService } from './services/companionAppService';
import { RegionService } from './services/regionService';
import { NoteService } from './services/noteService';
import { OpenAIService } from './services/openAIService';
import { TagAffinityCache } from './services/tagAffinityCache';
import { JSONExportService } from './services/jsonExportService';
import { CreateRegionCommands } from './commands/createRegionCommands';
import { ThoughtlandsSettings, DEFAULT_SETTINGS } from './settings/thoughtlandsSettings';
import { ThoughtlandsSidebarView, THOUGHTLANDS_VIEW_TYPE } from './views/thoughtlandsSidebarView';
import { Region } from './models/region';

export default class ThoughtlandsPlugin extends Plugin {
	settings: ThoughtlandsSettings;
	companionAppService: CompanionAppService;
	regionService: RegionService;
	noteService: NoteService;
	openAIService: OpenAIService;
	tagAffinityCache: TagAffinityCache;
	jsonExportService: JSONExportService;
	createRegionCommands: CreateRegionCommands;

	async onload() {
		await this.loadSettings();

		// Initialize cache
		this.tagAffinityCache = new TagAffinityCache();

		// Initialize services
		this.regionService = new RegionService(this.settings);
		this.noteService = new NoteService(this.app.metadataCache, this.app.vault, this.settings);
		this.openAIService = new OpenAIService(this.settings, this.tagAffinityCache);
		this.companionAppService = new CompanionAppService(this.settings);
		this.jsonExportService = new JSONExportService(this.app, this.regionService);
		this.createRegionCommands = new CreateRegionCommands(
			this.app,
			this.regionService,
			this.noteService,
			this.openAIService,
			this.settings
		);

		// Load regions from plugin data
		await this.loadRegions();

		// Register sidebar view
		this.registerView(
			THOUGHTLANDS_VIEW_TYPE,
			(leaf) => new ThoughtlandsSidebarView(
				leaf,
				this.regionService,
				this.companionAppService,
				() => this.onRegionUpdate()
			)
		);

		// Add commands
		this.addCommands();

		// Add settings tab
		this.addSettingTab(new ThoughtlandsSettingTab(this.app, this));

		// Initialize companion app connection
		await this.companionAppService.initialize();

		// Add ribbon icon to open sidebar
		this.addRibbonIcon('map', 'Thoughtlands', () => {
			this.activateView();
		});
	}

	onunload() {
		// Cleanup when plugin is unloaded
		this.companionAppService?.cleanup();
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Update all services with new settings
		if (this.regionService) {
			this.regionService.updateSettings(this.settings);
		}
		if (this.noteService) {
			this.noteService.updateSettings(this.settings);
		}
		if (this.openAIService) {
			this.openAIService.updateSettings(this.settings);
		}
		if (this.companionAppService) {
			this.companionAppService.updateSettings(this.settings);
		}
		// Update commands with new settings
		if (this.createRegionCommands) {
			this.createRegionCommands.updateSettings(this.settings);
		}
	}

	async loadRegions() {
		const regionsData = await this.loadData();
		if (regionsData?.regions && Array.isArray(regionsData.regions)) {
			this.regionService.setRegions(regionsData.regions);
		}
	}

	async saveRegions() {
		const regions = this.regionService.getRegions();
		await this.saveData({ regions });
		// Also export to JSON file
		try {
			await this.jsonExportService.exportRegionsToJSON();
		} catch (error) {
			console.error('Error exporting regions to JSON:', error);
		}
	}

	async onRegionUpdate() {
		await this.saveRegions();
		// Refresh sidebar view if open
		const leaves = this.app.workspace.getLeavesOfType(THOUGHTLANDS_VIEW_TYPE);
		leaves.forEach(leaf => {
			if (leaf.view instanceof ThoughtlandsSidebarView) {
				leaf.view.render();
			}
		});
	}

	private addCommands() {
		// Create Region from Search Results
		this.addCommand({
			id: 'create-region-from-search',
			name: 'Create Region from Search Results',
			callback: async () => {
				await this.createRegionCommands.createRegionFromSearch();
				await this.onRegionUpdate();
			},
		});

		// Create Region from Search + Tag Expansion
		this.addCommand({
			id: 'create-region-from-search-tags',
			name: 'Create Region from Search + Tag Expansion',
			callback: async () => {
				await this.createRegionCommands.createRegionFromSearchWithTags();
				await this.onRegionUpdate();
			},
		});

		// Create Region from AI Concept Search
		this.addCommand({
			id: 'create-region-from-concept',
			name: 'Create Region from AI Concept Search',
			callback: async () => {
				await this.createRegionCommands.createRegionFromConcept();
				await this.onRegionUpdate();
			},
		});

		// Export Regions to JSON
		this.addCommand({
			id: 'export-regions-json',
			name: 'Export Regions to JSON',
			callback: async () => {
				try {
					await this.jsonExportService.exportRegionsToJSON();
					new Notice('Regions exported to regions.json');
				} catch (error) {
					new Notice(`Error exporting regions: ${error}`);
				}
			},
		});

		// Open Thoughtlands Sidebar
		this.addCommand({
			id: 'open-thoughtlands-sidebar',
			name: 'Open Thoughtlands Sidebar',
			callback: () => {
				this.activateView();
			},
		});
	}

	async activateView() {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(THOUGHTLANDS_VIEW_TYPE)[0];
		if (!leaf) {
			const newLeaf = workspace.getRightLeaf(false);
			if (newLeaf) {
				await newLeaf.setViewState({ type: THOUGHTLANDS_VIEW_TYPE, active: true });
				leaf = newLeaf;
			}
		}
		if (leaf) {
			workspace.revealLeaf(leaf);
		}
	}
}

class ThoughtlandsSettingTab extends PluginSettingTab {
	plugin: ThoughtlandsPlugin;

	constructor(app: App, plugin: ThoughtlandsPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;

		containerEl.empty();

		containerEl.createEl('h2', { text: 'Thoughtlands Settings' });

		// OpenAI Settings
		new Setting(containerEl)
			.setName('OpenAI API Key')
			.setDesc('Your OpenAI API key for AI concept search')
			.addText(text => {
				text.setPlaceholder('sk-...')
					.setValue(this.plugin.settings.openAIApiKey);
				text.inputEl.type = 'password';
				text.onChange(async (value) => {
					this.plugin.settings.openAIApiKey = value;
					await this.plugin.saveSettings();
				});
			});

		new Setting(containerEl)
			.setName('AI Model')
			.setDesc('OpenAI model to use for concept search')
			.addDropdown(dropdown => {
				dropdown
					.addOption('gpt-3.5-turbo', 'GPT-3.5 Turbo')
					.addOption('gpt-4', 'GPT-4')
					.addOption('gpt-4-turbo-preview', 'GPT-4 Turbo')
					.setValue(this.plugin.settings.aiModel)
					.onChange(async (value) => {
						this.plugin.settings.aiModel = value;
						await this.plugin.saveSettings();
					});
			});

		// Ignored Tags
		new Setting(containerEl)
			.setName('Ignored Tags')
			.setDesc('Tags to ignore (one per line, without #)')
			.addTextArea(text => {
				text.setPlaceholder('tag1\ntag2\ntag3')
					.setValue(this.plugin.settings.ignoredTags.join('\n'));
				text.inputEl.rows = 5;
				text.onChange(async (value) => {
					this.plugin.settings.ignoredTags = value
						.split('\n')
						.map(t => t.trim())
						.filter(t => t.length > 0);
					await this.plugin.saveSettings();
				});
			});

		// Ignored Paths
		new Setting(containerEl)
			.setName('Ignored Paths')
			.setDesc('Paths to ignore (one per line)')
			.addTextArea(text => {
				text.setPlaceholder('Templates/\nArchive/')
					.setValue(this.plugin.settings.ignoredPaths.join('\n'));
				text.inputEl.rows = 5;
				text.onChange(async (value) => {
					this.plugin.settings.ignoredPaths = value
						.split('\n')
						.map(p => p.trim())
						.filter(p => p.length > 0);
					await this.plugin.saveSettings();
				});
			});

		// Default Colors
		new Setting(containerEl)
			.setName('Default Color Palette')
			.setDesc('Default colors for regions (comma-separated hex codes)')
			.addText(text => text
				.setPlaceholder('#E67E22, #3498DB, #9B59B6')
				.setValue(this.plugin.settings.defaultColors.join(', '))
				.onChange(async (value) => {
					this.plugin.settings.defaultColors = value
						.split(',')
						.map(c => c.trim())
						.filter(c => /^#[0-9A-Fa-f]{6}$/i.test(c));
					await this.plugin.saveSettings();
				}));

		// Max Related Tags
		new Setting(containerEl)
			.setName('Max Related Tags')
			.setDesc('Maximum number of tags to suggest from AI concept search')
			.addText(text => text
				.setPlaceholder('10')
				.setValue(this.plugin.settings.maxRelatedTags.toString())
				.onChange(async (value) => {
					const max = parseInt(value) || 10;
					this.plugin.settings.maxRelatedTags = max;
					await this.plugin.saveSettings();
				}));

		// Companion App Settings
		containerEl.createEl('h3', { text: 'Companion App Settings' });

		new Setting(containerEl)
			.setName('Companion App URL')
			.setDesc('The URL or address of the companion app')
			.addText(text => text
				.setPlaceholder('http://localhost:3000')
				.setValue(this.plugin.settings.companionAppUrl)
				.onChange(async (value) => {
					this.plugin.settings.companionAppUrl = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Enable Companion App')
			.setDesc('Enable communication with the companion app')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.enableCompanionApp)
				.onChange(async (value) => {
					this.plugin.settings.enableCompanionApp = value;
					await this.plugin.saveSettings();
				}));

		new Setting(containerEl)
			.setName('Connection Timeout')
			.setDesc('Timeout in milliseconds for companion app connections')
			.addText(text => text
				.setPlaceholder('5000')
				.setValue(this.plugin.settings.connectionTimeout.toString())
				.onChange(async (value) => {
					const timeout = parseInt(value) || 5000;
					this.plugin.settings.connectionTimeout = timeout;
					await this.plugin.saveSettings();
				}));
	}
}
