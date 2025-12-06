export class TagAffinityCache {
	private cache: Map<string, string[]> = new Map();
	private maxSize: number = 100;

	get(key: string): string[] | null {
		return this.cache.get(key) || null;
	}

	set(key: string, tags: string[]): void {
		// Implement LRU-like behavior if cache gets too large
		if (this.cache.size >= this.maxSize) {
			// Remove oldest entry (simple FIFO for now)
			const firstKey = this.cache.keys().next().value;
			if (firstKey) {
				this.cache.delete(firstKey);
			}
		}
		this.cache.set(key, tags);
	}

	clear(): void {
		this.cache.clear();
	}

	getSize(): number {
		return this.cache.size;
	}
}

