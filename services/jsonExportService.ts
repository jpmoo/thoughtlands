import { RegionService } from './regionService';
import { App, TFile } from 'obsidian';

export class JSONExportService {
	private app: App;
	private regionService: RegionService;

	constructor(app: App, regionService: RegionService) {
		this.app = app;
		this.regionService = regionService;
	}

	async exportRegionsToJSON(): Promise<void> {
		const regionsData = this.regionService.exportToJSON();
		const jsonContent = JSON.stringify(regionsData, null, 2);
		
		// Write to vault root as regions.json
		const fileName = 'regions.json';
		const filePath = fileName;

		try {
			// Check if file exists
			const existingFile = this.app.vault.getAbstractFileByPath(filePath);
			
			if (existingFile && existingFile instanceof TFile) {
				// Update existing file
				await this.app.vault.modify(existingFile, jsonContent);
			} else {
				// Create new file
				await this.app.vault.create(filePath, jsonContent);
			}
		} catch (error) {
			console.error('Error exporting regions to JSON:', error);
			throw error;
		}
	}

	async exportRegionsToJSONFile(customPath?: string): Promise<string> {
		const regionsData = this.regionService.exportToJSON();
		const jsonContent = JSON.stringify(regionsData, null, 2);
		
		const fileName = customPath || 'regions.json';
		
		try {
			const existingFile = this.app.vault.getAbstractFileByPath(fileName);
			
			if (existingFile && existingFile instanceof TFile) {
				await this.app.vault.modify(existingFile, jsonContent);
			} else {
				await this.app.vault.create(fileName, jsonContent);
			}
			
			return fileName;
		} catch (error) {
			console.error('Error exporting regions to JSON:', error);
			throw error;
		}
	}
}

