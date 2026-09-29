<div align="center">
  <h1>🌉 Obsidian MindMap Bridge (v1.1.0)</h1>
  <p>An Obsidian plugin that seamlessly connects your local vault (<code>.mindmap.json</code> &amp; <code>.md</code> notes) to the PixiJS v8 WebGL <b>MindMap Studio</b>.</p>
</div>

## 📖 Overview

**Obsidian MindMap Bridge** visualizes your Obsidian notes and `.mindmap.json` graphs as hardware-accelerated 60 FPS interactive mind maps without dragging down Obsidian's Electron performance.

Instead of rendering thousands of heavy HTML nodes locally, this plugin compiles your `.mindmap.json` or Markdown (`.md`) notes into a validated `MindMapData` payload and streams it via a secure `postMessage` iframe bridge to our **PixiJS v8 WebGL Cloud App** (`https://mindmap.riyasaksena502.workers.dev`).

## ✨ Features

- **⚡ Custom View for `.mindmap.json` & `.md` Notes:** Automatically opens `.mindmap.json` files in the WebGL MindMap Studio and lets you open or export any standard Obsidian `.md` note as an interactive Mind Map.
- **🔗 Bi-Directional Communication (`MINDMAP_DATA` ⇄ `OPEN_NOTE`):**
  - **Send (`Obsidian -> WebGL`):** Pushes `.mindmap.json` or live-compiled `.md` data to the cloud viewer via `postMessage` with debounced live-reload on save.
  - **Receive (`WebGL -> Obsidian`):** Listens for **"Obsidian में खोलें" (`⌘↵` / `Ctrl+Enter`)** clicks (`{ action: "OPEN_NOTE", nodeId }`) from the Google Stitch Porcelain Inspector and opens the corresponding note or `#heading` in a beside split/tab.
- **📝 Built-in Markdown-to-MindMap Compiler (`src/markdownParser.ts`):**
  - Converts `#`–`######` headings into hierarchical branches, bullet lists into Active Recall `keyFacts`, `[[WikiLinks]]` into deep-linkable node IDs and `crossLinks`, and `#tags` into concept chips.
  - Automatically detects Hindi (`hi`), English (`en`), or bilingual (`mixed`) content.
- **🎨 Rich Google Stitch Starter Template:** Creating a new MindMap JSON file populates a ready-to-use graph with `subtitle`, `description`, `badge`, `keyFacts`, and sample `quizQuestions`.

## 🚀 Commands & Context Menus

- **Command / Ribbon:** `Open active file as Mind Map` (works on `.mindmap.json`, `.json`, and `.md` files)
- **Command / File Menu:** `Export active Markdown note to .mindmap.json`
- **Command / Folder Menu:** `Create new MindMap JSON file`
- **View Header Actions:**
  - `Reload MindMap Viewer`
  - `Export as .mindmap.json`
  - `Open as Text / Raw Editor`

## 🛠️ Development & Installation

1. Install dependencies:
   ```bash
   cd obsidian-mindmap-bridge
   npm install
   ```
2. Type-check & build the production bundle (`main.js`):
   ```bash
   npx tsc --noEmit
   npm run build
   ```
3. Copy `main.js`, `manifest.json`, and `styles.css` into `<your-vault>/.obsidian/plugins/obsidian-mindmap-bridge/` and enable **MindMap Viewer Bridge** in Obsidian Settings -> Community Plugins.

## 📄 License

This project is licensed under the MIT License.
