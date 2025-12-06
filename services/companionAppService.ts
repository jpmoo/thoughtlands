import { ThoughtlandsSettings } from '../settings/thoughtlandsSettings';

export interface CompanionAppResponse {
	success: boolean;
	data?: any;
	error?: string;
}

export class CompanionAppService {
	private settings: ThoughtlandsSettings;
	private isInitialized: boolean = false;

	constructor(settings: ThoughtlandsSettings) {
		this.settings = settings;
	}

	async initialize(): Promise<void> {
		if (!this.settings.enableCompanionApp) {
			console.log('Companion app is disabled');
			return;
		}

		try {
			// Test connection to companion app
			const isConnected = await this.testConnection();
			if (isConnected) {
				this.isInitialized = true;
				console.log('Companion app service initialized successfully');
			} else {
				console.warn('Could not connect to companion app');
			}
		} catch (error) {
			console.error('Error initializing companion app service:', error);
		}
	}

	async testConnection(): Promise<boolean> {
		try {
			const response = await this.sendRequest('/health', 'GET');
			return response.success;
		} catch (error) {
			return false;
		}
	}

	async sendRequest(
		endpoint: string,
		method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET',
		data?: any
	): Promise<CompanionAppResponse> {
		if (!this.settings.enableCompanionApp) {
			return {
				success: false,
				error: 'Companion app is disabled',
			};
		}

		const url = `${this.settings.companionAppUrl}${endpoint}`;
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), this.settings.connectionTimeout);
		const options: RequestInit = {
			method,
			headers: {
				'Content-Type': 'application/json',
			},
			signal: controller.signal,
		};

		if (data && (method === 'POST' || method === 'PUT')) {
			options.body = JSON.stringify(data);
		}

		try {
			const response = await fetch(url, options);
			clearTimeout(timeoutId);
			const responseData = await response.json();

			return {
				success: response.ok,
				data: responseData,
				error: response.ok ? undefined : `HTTP ${response.status}: ${response.statusText}`,
			};
		} catch (error) {
			clearTimeout(timeoutId);
			return {
				success: false,
				error: error instanceof Error ? error.message : 'Unknown error occurred',
			};
		}
	}

	updateSettings(newSettings: ThoughtlandsSettings): void {
		this.settings = newSettings;
		// Reinitialize if settings changed
		if (this.settings.enableCompanionApp && !this.isInitialized) {
			this.initialize();
		} else if (!this.settings.enableCompanionApp) {
			this.isInitialized = false;
		}
	}

	cleanup(): void {
		this.isInitialized = false;
		// Add any cleanup logic here (e.g., close connections, clear intervals)
	}

	isReady(): boolean {
		return this.isInitialized && this.settings.enableCompanionApp;
	}
}

