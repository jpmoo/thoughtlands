# Thoughtlands

**Chart the terrain of your thinking.**

Thoughtlands is an Obsidian plugin that organizes and visualizes conceptual relationships across notes in your vault. It creates "regions" (semantic clusters) of related notes that can be visualized on Obsidian canvases.

## Features

### Region Creation Methods

1. **Create Region from Search Results** - Collects active search result files and creates a region
2. **Create Region from Search Results + AI Analysis** - Uses semantic similarity analysis to find additional related notes beyond the search results (requires local AI mode)
3. **Create Region from AI-Assisted Concept/Tag Analysis** - Uses AI (OpenAI or local model) to find related tags based on concepts, then gathers all notes using those tags. With local AI, can refine results using semantic similarity analysis.
4. **Create Region from Semantic Similarity Analysis** - Directly finds notes semantically similar to descriptive text you provide (requires local AI mode)

### Core Features

- **Sidebar View** - Visual display of all created regions with management options
- **Tag Affinity Cache** - Caches AI concept→tag mappings to minimize API calls
- **Semantic Similarity Analysis** - Uses embeddings to find semantically related notes
- **Local AI Support** - Works with Ollama for local embedding generation and AI analysis
- **OpenAI Integration** - Supports OpenAI for tag-based concept analysis
- **Ignore Filters** - Filter out specific tags and paths from region creation
- **Customizable Color Palette** - Set default colors for regions
- **Canvas Integration** - Add regions to Obsidian canvases for visualization
- **Export to JSON** - Exports all region data to `regions.json`

## Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run build` to build the plugin
4. Copy the `main.js`, `manifest.json`, and `styles.css` files to your vault's `.obsidian/plugins/thoughtlands/` directory
5. Enable the plugin in Obsidian's settings

## Development

### Setup

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run dev` to start compilation in watch mode
4. Make changes to the files in the project
5. Reload Obsidian to see your changes

### Building for Production

Run `npm run build` to build the plugin for production.

## Project Structure

```
.
├── main.ts                          # Main plugin entry point
├── manifest.json                    # Plugin manifest
├── package.json                     # Dependencies and scripts
├── tsconfig.json                    # TypeScript configuration
├── esbuild.config.mjs               # Build configuration
├── styles.css                       # Custom CSS styles
├── models/                          # Data models
│   └── region.ts                    # Region data model
├── settings/                        # Settings interfaces
│   └── thoughtlandsSettings.ts      # Settings interface and defaults
├── services/                        # Service modules
│   ├── regionService.ts             # Region management
│   ├── noteService.ts               # Note and tag operations
│   ├── openAIService.ts             # OpenAI integration
│   ├── localAIService.ts           # Local AI (Ollama) integration
│   ├── embeddingService.ts          # Embedding generation and similarity analysis
│   ├── embeddingStorageService.ts   # Embedding storage and management
│   ├── tagAffinityCache.ts          # Tag affinity caching
│   ├── canvasService.ts             # Canvas integration
│   └── jsonExportService.ts         # JSON export functionality
├── commands/                        # Command implementations
│   └── createRegionCommands.ts      # Region creation commands
├── views/                           # View components
│   └── thoughtlandsSidebarView.ts   # Sidebar view
└── ui/                              # UI components
    ├── simplePromptModal.ts         # Simple text input modal
    ├── colorPickerModal.ts          # Color picker modal
    ├── conceptInputModal.ts         # Concept input modal
    └── regionInfoModal.ts           # Region information modal
```

## Usage

### Creating Regions

#### From Search Results

1. Perform a search in Obsidian
2. Click "From Search Results" in the Thoughtlands sidebar or run the command
3. Enter a name and select a color
4. The region will be created with all files from your search results

#### From Search Results + AI Analysis

1. Ensure local AI mode is enabled and embeddings are generated
2. Perform a search in Obsidian
3. Click "From Search Results + AI Analysis" in the Thoughtlands sidebar
4. The plugin will:
   - Use embeddings from search results to compute a semantic centroid
   - Find additional notes semantically similar to the search results
   - Create a region with both search results and similar notes

#### From AI-Assisted Concept/Tag Analysis

1. Click "From AI-Assisted Concept/Tag Analysis" in the Thoughtlands sidebar
2. Enter concepts (a sentence or two describing what you're looking for)
3. Select a scope (Narrow, Regular, or Broad)
4. The plugin will:
   - Query AI (OpenAI or local model) for related tags
   - Optionally refine tags by reviewing note excerpts
   - Find all notes with those tags
   - If using local AI, apply semantic similarity filtering
   - Create a region with the selected notes

#### From Semantic Similarity Analysis

1. Ensure local AI mode is enabled and embeddings are generated
2. Click "From Semantic Similarity Analysis" in the Thoughtlands sidebar
3. Enter descriptive text about what you're looking for
4. The plugin will:
   - Generate an embedding for your concept text
   - Find all notes semantically similar to your concept
   - Create a region with the matching notes

### Managing Regions

- Open the Thoughtlands sidebar to view all regions
- Click on a region to view its details
- Rename, delete, or add regions to canvases
- Regions are automatically exported to `regions.json` in your vault root

### Embeddings (Local AI Mode)

When using local AI mode, you'll need to generate embeddings for your notes:

1. Run the command "Generate Initial Embeddings"
2. The plugin will process all markdown files in your vault
3. Embeddings are stored and used for semantic similarity analysis
4. New and modified files are automatically processed when embeddings are complete

## Settings

Configure the plugin in Obsidian Settings → Thoughtlands:

- **AI Mode** - Choose between OpenAI or Local (Ollama)
- **OpenAI API Key** - Required for OpenAI mode
- **Local AI Model** - Model name for Ollama (e.g., "nomic-embed-text")
- **AI Model** - OpenAI model selection (GPT-3.5 Turbo, GPT-4, etc.)
- **Ignored Tags** - Tags to exclude from region creation
- **Ignored Paths** - Paths to exclude from region creation
- **Included Tags** - Only process notes with these tags (optional)
- **Included Paths** - Only process notes in these paths (optional)
- **Default Color Palette** - Default colors for new regions
- **Embedding Similarity Threshold** - Minimum similarity score for semantic matching (0.0-1.0, default: 0.45)
- **Max Related Tags** - Maximum tags to suggest from AI

## Data Format

Regions are exported to `regions.json` in the following format:

```json
{
  "regions": [
    {
      "id": "region_001",
      "name": "Mentorship & Belonging",
      "color": "#E67E22",
      "mode": "concept",
      "source": {
        "type": "concept",
        "concepts": ["mentorship", "belonging"],
        "aiMode": "local",
        "processingInfo": {
          "initialTags": ["mentorship", "community"],
          "similarityThreshold": 0.45
        }
      },
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "notes": ["Equity_Framework.md", "Student_Voice.md"],
      "canvases": [
        {
          "path": "My Canvas.canvas",
          "addedAt": "2024-01-01T00:00:00.000Z",
          "isNew": false
        }
      ]
    }
  ]
}
```

## Commands

- `Create Region from Search Results` - Create a region from current search results
- `Create Region from Search Results + AI Analysis` - Create a region with AI semantic analysis (local mode only)
- `Create Region from AI-Assisted Concept/Tag Analysis` - Create a region using AI concept search
- `Create Region from Semantic Similarity Analysis` - Create a region using direct semantic similarity (local mode only)
- `Export Regions to JSON` - Manually export regions to JSON
- `Generate Initial Embeddings` - Generate embeddings for all notes (local mode only)
- `Open Thoughtlands Sidebar` - Open the regions sidebar view

## License

MIT

## Branding

**Plugin Name:** Thoughtlands  
**Theme:** Cartographic exploration of ideas  
**Tagline:** "Chart the terrain of your thinking."
