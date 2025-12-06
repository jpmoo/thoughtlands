# Thoughtlands

**Chart the terrain of your thinking.**

Thoughtlands is an Obsidian plugin that organizes and visualizes conceptual relationships across notes, tags, and projects in your vault. It creates "regions" (semantic clusters) of related notes that can be rendered visually by a companion app.

## Features

### Core Functions

1. **Create Region from Search Results** - Collects active search result files and creates a region
2. **Create Region from Search + Tag Expansion** - Gathers all tags from search results and expands to all notes sharing those tags
3. **Create Region from AI Concept Search** - Uses OpenAI to find related tags based on concepts, then gathers all notes using those tags
4. **Export to JSON** - Exports all region data to `regions.json` for visualization by the companion app

### Features

- **Sidebar View** - Visual display of all created regions with management options
- **Tag Affinity Cache** - Caches AI concept→tag mappings to minimize API calls
- **Ignore Filters** - Filter out specific tags and paths from region creation
- **Customizable Color Palette** - Set default colors for regions
- **Companion App Integration** - Connect to a companion app for visualization

## Installation

1. Clone this repository
2. Run `npm install` to install dependencies
3. Run `npm run dev` to start compilation in watch mode
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
│   ├── companionAppService.ts       # Companion app communication
│   ├── regionService.ts             # Region management
│   ├── noteService.ts               # Note and tag operations
│   ├── openAIService.ts             # OpenAI integration
│   ├── tagAffinityCache.ts          # Tag affinity caching
│   └── jsonExportService.ts         # JSON export functionality
├── commands/                        # Command implementations
│   └── createRegionCommands.ts      # Region creation commands
└── ui/                              # UI components
    ├── simplePromptModal.ts         # Simple text input modal
    └── colorPickerModal.ts          # Color picker modal
```

## Usage

### Creating Regions

#### From Search Results

1. Perform a search in Obsidian
2. Run the command "Create Region from Search Results"
3. Enter a name and select a color
4. The region will be created with all files from your search results

#### From Search + Tag Expansion

1. Perform a search in Obsidian
2. Run the command "Create Region from Search + Tag Expansion"
3. The plugin will:
   - Extract all tags from search results
   - Find all notes with those tags
   - Create a region with the expanded set of notes

#### From AI Concept Search

1. Run the command "Create Region from AI Concept Search"
2. Enter concepts (comma-separated)
3. The plugin will:
   - Query OpenAI for related tags
   - Find all notes with those tags
   - Create a region with those notes

### Managing Regions

- Open the Thoughtlands sidebar to view all regions
- Rename, delete, or open regions in the companion app
- Regions are automatically exported to `regions.json` in your vault root

## Settings

Configure the plugin in Obsidian Settings → Thoughtlands:

- **OpenAI API Key** - Required for AI concept search
- **AI Model** - Choose between GPT-3.5 Turbo, GPT-4, etc.
- **Ignored Tags** - Tags to exclude from region creation
- **Ignored Paths** - Paths to exclude from region creation
- **Default Color Palette** - Default colors for new regions
- **Max Related Tags** - Maximum tags to suggest from AI
- **Companion App URL** - URL of the companion visualization app
- **Enable Companion App** - Toggle companion app integration

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
        "concepts": ["mentorship", "belonging"]
      },
      "createdAt": "2024-01-01T00:00:00.000Z",
      "updatedAt": "2024-01-01T00:00:00.000Z",
      "notes": ["Equity_Framework.md", "Student_Voice.md"]
    }
  ]
}
```

## Commands

- `Create Region from Search Results` - Create a region from current search results
- `Create Region from Search + Tag Expansion` - Create a region with tag expansion
- `Create Region from AI Concept Search` - Create a region using AI concept search
- `Export Regions to JSON` - Manually export regions to JSON
- `Open Thoughtlands Sidebar` - Open the regions sidebar view

## License

MIT

## Branding

**Plugin Name:** Thoughtlands  
**Theme:** Cartographic exploration of ideas  
**Tagline:** "Chart the terrain of your thinking."
