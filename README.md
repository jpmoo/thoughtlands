# Thoughtlands

**Chart the terrain of your thinking.**

Thoughtlands is an Obsidian plugin that organizes and visualizes conceptual relationships across notes in your vault. It creates "regions" (semantic clusters) of related notes that can be visualized on Obsidian canvases with sophisticated layout algorithms.

## Features

### Region Creation Methods

1. **Create Region from Search Results** - Enter search terms to find matching notes across your vault (searches metadata and content)
2. **Create Region from Search Results + AI Analysis** - Enter search terms to find matching notes, then uses semantic similarity analysis to find additional related notes (requires local AI model)
3. **Create Region from AI-Assisted Concept/Tag Analysis** - Uses AI (OpenAI or local model) to find related tags based on concepts, then gathers all notes using those tags. With local AI, can refine results using semantic similarity analysis.
4. **Create Region from Semantic Similarity Analysis** - Directly finds notes semantically similar to descriptive text you provide (requires local AI mode)

### Canvas Visualization Modes

When adding regions to canvases, Thoughtlands offers multiple sophisticated layout modes:

#### Walkabout Mode
- **Radial Layout** - Notes are arranged around a central concept card
- **Distance = Similarity** - Distance from center reflects semantic similarity to the central concept
- **Clustering Control** - 4-level slider (1-4) to control how tightly similar notes cluster together
  - Level 1: Wide, natural spread with minimal clustering
  - Level 2-3: Moderate clustering with breathing room
  - Level 4: Tight clustering with cluster summary cards
- **Cluster Summary Cards** - At clustering level 4, AI-generated summary cards appear near each cluster (1+ notes) with 4-6 sentence summaries
- **Organic Distribution** - Uses normalized 2D layouts with Gaussian noise to prevent "swirl" effects and ensure even 360-degree distribution

#### Hopscotch & Rolling Path Modes
- **Path-Based Layout** - Notes arranged in a diagonal path from left to right
- **Semantic Ordering** - Notes ordered by similarity to the central concept
- **Path Summary Cards** - AI-generated 4-6 sentence summary card at the end of the path that answers the central concept as a question

#### Crowd Mode
- **Two Layout Options**:
  - **Regiment** - Uniform grid arrangement for structured visualization
  - **Gaggle** - Organic, jumbled crowd layout with random placement and heavy Gaussian noise for maximum chaos and no grid patterns
- **Compact Circular Area** - Notes arranged in a roughly circular area below the central card
- **Non-Overlapping** - Ensures notes don't overlap while maintaining organic appearance

### Core Features

- **Sidebar View** - Visual display of all created regions with management options
  - **Active/Archived Views** - Toggle between active and archived regions
  - **Region Sorting** - Regions sorted by date (most recent first)
  - **Quick Actions** - Info, rename, archive/unarchive, add to canvas, delete
- **Region Archiving** - Archive regions to keep them organized without deleting
- **Tag Affinity Cache** - Caches AI concept→tag mappings to minimize API calls
- **Semantic Similarity Analysis** - Uses embeddings to find semantically related notes
- **Local AI Support** - Works with Ollama for local embedding generation, AI analysis, and summary generation
- **OpenAI Integration** - Supports OpenAI for tag-based concept analysis
- **Ignore Filters** - Filter out specific tags and paths from region creation
- **Customizable Color Palette** - Set default colors for regions
- **Canvas Integration** - Add regions to Obsidian canvases with sophisticated layout algorithms
- **Progress Indicators** - Real-time progress updates when creating regions or generating canvases
- **Missing File Management** - Detect and remove references to missing canvas files
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
│   ├── localAIService.ts            # Local AI (Ollama) integration
│   ├── embeddingService.ts          # Embedding generation and similarity analysis
│   ├── embeddingStorageService.ts   # Embedding storage and management
│   ├── tagAffinityCache.ts          # Tag affinity caching
│   ├── canvasService.ts             # Canvas integration with layout algorithms
│   └── jsonExportService.ts         # JSON export functionality
├── commands/                        # Command implementations
│   └── createRegionCommands.ts      # Region creation commands
├── views/                           # View components
│   └── thoughtlandsSidebarView.ts   # Sidebar view
└── ui/                              # UI components
    ├── simplePromptModal.ts         # Simple text input modal
    ├── colorPickerModal.ts          # Color picker modal
    ├── conceptInputModal.ts         # Concept input modal
    ├── canvasSelectModal.ts         # Canvas selection and layout configuration
    ├── cardInputModal.ts            # Card input modal
    └── regionInfoModal.ts           # Region information modal
```

## Usage

### Creating Regions

#### From Search Results

1. Click "From Search Results" in the Thoughtlands sidebar or run the command
2. Enter search terms when prompted (e.g., "John Adams" or "mentorship")
3. The plugin will search all files in your vault (metadata and content) for matching terms
4. Results are filtered by your plugin settings (included/excluded paths and tags)
5. Enter a name and select a color
6. The region will be created with all matching files

#### From Search Results + AI Analysis

1. Ensure local AI mode is enabled and embeddings are generated
2. Click "From Search Results + AI Analysis" in the Thoughtlands sidebar
3. Enter search terms when prompted (e.g., "John Adams" or "mentorship")
4. The plugin will:
   - Search all files in your vault (metadata and content) for matching terms
   - Filter results by your plugin settings (included/excluded paths and tags)
   - Use embeddings from matching notes to compute a semantic centroid
   - Find additional notes semantically similar to the search results
   - Create a region with both search results and similar notes

#### From AI-Assisted Concept/Tag Analysis

1. Click "From AI-Assisted Concept/Tag Analysis" in the Thoughtlands sidebar
2. Enter concepts (a sentence or two describing what you're looking for)
3. Select a scope (Narrow, Regular, or Broad)
4. The plugin will:
   - Query AI (OpenAI or local model) for related tags
   - Refine tags by reviewing note excerpts
   - Find all notes with those tags
   - If using local AI, apply semantic similarity filtering
   - Create a region with the selected notes

#### From Semantic Similarity Analysis

1. Ensure local AI mode is enabled and embeddings are generated
2. Click "From Semantic Similarity Analysis" in the Thoughtlands sidebar
3. Enter descriptive text about what you're looking for
4. Select a layout mode:
   - **Walkabout** - Radial layout with clustering control (up to 100 notes)
   - **Hopscotch** - Path-based layout (up to 50 notes)
   - **Rolling Path** - Path-based layout (up to 50 notes)
   - **Crowd** - Grid or organic crowd layout (up to 100 notes)
5. The plugin will:
   - Generate an embedding for your concept text
   - Find notes semantically similar to your concept (based on similarity threshold)
   - Create a region with the matching notes
   
   **Note:** Walkabout and Crowd modes support up to 100 notes. Path modes (Hopscotch, Rolling Path) support up to 50 notes. To be more selective, increase the embedding similarity threshold in settings (default: 0.65).

### Managing Regions

- **Sidebar View** - Open the Thoughtlands sidebar to view all regions
  - Toggle between **Active** and **Archived** views
  - Regions are sorted by date (most recent first)
- **Region Actions**:
  - **Info** - View detailed information, re-run analysis, manage canvases
  - **Rename** - Change the region name
  - **Archive/Unarchive** - Move regions between active and archived views
  - **Add Canvas** - Add the region to a canvas with layout configuration
  - **Delete** - Remove the region permanently
- **Region Info Modal**:
  - View all notes in the region
  - See processing information and statistics
  - Re-run analysis with different parameters
  - Manage canvas references
  - Remove missing file references
- Regions are automatically exported to `regions.json` in your vault root

### Adding Regions to Canvases

1. Click the canvas icon on a region in the sidebar
2. Choose to create a new canvas or add to an existing one
3. Configure layout options:
   - **Walkabout Mode**:
     - Set clustering level (1-4) - controls how tightly similar notes cluster
     - Add a central concept card with custom text and color
   - **Path Modes** (Hopscotch, Rolling Path):
     - Add a central concept card
     - Summary card will be generated at the end of the path
   - **Crowd Mode**:
     - Choose **Regiment** (grid) or **Gaggle** (organic crowd)
     - Add a central concept card
4. The plugin will:
   - Calculate semantic similarities
   - Arrange notes according to the selected layout mode
   - Generate summary cards (if applicable)
   - Create or update the canvas file

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
- **Local AI Model** - Model name for Ollama embeddings (e.g., "nomic-embed-text")
- **Local AI Chat Model** - Model name for Ollama chat/summaries (e.g., "llama3.2")
- **Ollama URL** - URL for Ollama API (default: http://localhost:11434)
- **AI Model** - OpenAI model selection (GPT-3.5 Turbo, GPT-4, etc.)
- **Ignored Tags** - Tags to exclude from region creation
- **Ignored Paths** - Paths to exclude from region creation
- **Included Tags** - Only process notes with these tags (optional)
- **Included Paths** - Only process notes in these paths (optional)
- **Default Color Palette** - Default colors for new regions
- **Embedding Similarity Threshold** - Minimum similarity score for semantic matching (0.0-1.0, default: 0.65)
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
          "semanticSimilarityMode": "walkabout",
          "similarityThreshold": 0.65
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
      ],
      "archived": false
    }
  ]
}
```

## Commands

- `Create Region from Search Results` - Enter search terms to find matching notes and create a region
- `Create Region from Search Results + AI Analysis` - Enter search terms, then use AI semantic analysis to find additional related notes (local mode only)
- `Create Region from AI-Assisted Concept/Tag Analysis` - Create a region using AI concept search
- `Create Region from Semantic Similarity Analysis` - Create a region using direct semantic similarity (local mode only)
- `Export Regions to JSON` - Manually export regions to JSON
- `Generate Initial Embeddings` - Generate embeddings for all notes (local mode only)
- `Open Thoughtlands Sidebar` - Open the regions sidebar view

## Layout Algorithms

### Walkabout Mode

The walkabout layout uses a sophisticated multi-step algorithm:

1. **Similarity Calculation** - Computes semantic similarity between each note and the central concept
2. **Radius Mapping** - Maps similarity to radial distance (more similar = closer to center)
3. **2D Layout** - Creates a 2D force-directed layout based on note-to-note similarities
4. **Normalization** - Centers and normalizes the 2D layout to prevent swirl effects
5. **Angle Calculation** - Converts normalized 2D coordinates to polar angles
6. **Clustering** - Uses k-means clustering to group similar notes
7. **Interpolation** - Smoothly interpolates between free and clustered positions based on clustering level
8. **Spread Application** - Adds radial and angular offsets within clusters to prevent stacking

### Path Modes (Hopscotch, Rolling Path)

- Notes arranged diagonally from left to right
- Ordered by similarity to central concept
- Summary card generated at the end using local AI

### Crowd Mode

- **Regiment**: Uniform grid layout for structured visualization
- **Gaggle**: Pure random placement with heavy Gaussian noise for organic, jumbled appearance with no grid patterns

## License

MIT

## Branding

**Plugin Name:** Thoughtlands  
**Theme:** Cartographic exploration of ideas  
**Tagline:** "Chart the terrain of your thinking."
