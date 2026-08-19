# Obsidian MindMap Bridge

An Obsidian plugin that connects local vault MindMap JSON files to the Cloudflare Mind Map Viewer.

## Features

- Custom file view for `.mindmap.json` and `.mindmap` files in Obsidian.
- Interactive mind map visualization embedded directly within Obsidian.
- Seamless synchronization and bridge between local vault mind maps and the web viewer.
- Configurable settings for viewer endpoints and options.

## Installation

### From Source / Manual Installation

1. Clone this repository into your Obsidian vault's plugin directory:
   ```bash
   cd <your-vault>/.obsidian/plugins/
   git clone https://github.com/naksh-07/obsidian-mindmap-bridge.git
   ```
2. Install dependencies and build:
   ```bash
   cd obsidian-mindmap-bridge
   npm install
   npm run build
   ```
3. Enable **MindMap Viewer Bridge** in Obsidian Settings -> Community Plugins.

## Development

- `npm run dev` - Run esbuild in watch mode.
- `npm run build` - Build production bundle.

## License

MIT
