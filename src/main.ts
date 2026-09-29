import { Plugin, TFile, TFolder, WorkspaceLeaf, FileView, normalizePath, Notice } from "obsidian";
import { MindMapFileView } from "./MindMapFileView";
import { MindMapBridgeSettings, DEFAULT_SETTINGS, MindMapBridgeSettingTab } from "./Settings";
import { convertMarkdownToMindMapData } from "./markdownParser";

export const VIEW_TYPE_MINDMAP = "mindmap-json-view";

export default class MindMapBridgePlugin extends Plugin {
    settings!: MindMapBridgeSettings;
    private bypassAutoMindMapPaths = new Map<string, number>();
    private rawEditorLeaves = new WeakSet<WorkspaceLeaf>();

    async onload(): Promise<void> {
        await this.loadSettings();

        // 1. Register MindMap View & Extensions
        this.registerView(
            VIEW_TYPE_MINDMAP,
            (leaf) => new MindMapFileView(leaf, this)
        );

        this.registerExtensions(["mindmap.json"], VIEW_TYPE_MINDMAP);

        // 2. Register Settings Tab
        this.addSettingTab(new MindMapBridgeSettingTab(this.app, this));

        // 3. Register Vault Modify Listener for Live Sync
        this.registerEvent(
            this.app.vault.on("modify", (file) => {
                if (this.settings.autoRefreshOnSave && file instanceof TFile) {
                    this.app.workspace.iterateAllLeaves((leaf) => {
                        if (leaf.view instanceof MindMapFileView) {
                            leaf.view.handleFileModification(file);
                        }
                    });
                }
            })
        );

        // 4. Register File Open listener for automatic opening of *.mindmap.json
        this.registerEvent(
            this.app.workspace.on("file-open", (file) => {
                if (file && this.isMindMapFile(file)) {
                    const existingTimer = this.bypassAutoMindMapPaths.get(file.path);
                    if (existingTimer !== undefined) {
                        window.clearTimeout(existingTimer);
                        this.bypassAutoMindMapPaths.delete(file.path);
                        return;
                    }

                    // Find active FileView displaying this file
                    const activeFileView = this.app.workspace.getActiveViewOfType(FileView);
                    const targetLeaf = (activeFileView && activeFileView.file?.path === file.path)
                        ? activeFileView.leaf
                        : this.getLeafForFile(file);

                    // Respect leaves explicitly switched to Raw JSON / Text editor by the user
                    if (targetLeaf && this.rawEditorLeaves.has(targetLeaf)) {
                        return;
                    }

                    // Check if file is already displayed in a MindMap view leaf
                    const existingMindMapLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP).find(
                        (l) => l.view instanceof MindMapFileView && l.view.file?.path === file.path
                    );
                    if (existingMindMapLeaf) {
                        this.app.workspace.revealLeaf(existingMindMapLeaf);
                        return;
                    }

                    if (targetLeaf && targetLeaf.view.getViewType() !== VIEW_TYPE_MINDMAP) {
                        void this.openFileInMindMapViewer(file, targetLeaf);
                    }
                }
            })
        );

        // Scan leaves on layout ready to convert any open *.mindmap.json leaves to MindMapFileView
        this.app.workspace.onLayoutReady(() => {
            this.scanAndConvertMindMapLeaves();
        });

        // 5. Register Context Menu Entry for File Explorer & Editor
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (file instanceof TFile) {
                    if (this.isMindMapFile(file) || this.isJsonFile(file) || this.isMarkdownFile(file)) {
                        menu.addItem((item) => {
                            item
                                .setTitle("Open as Mind Map")
                                .setIcon("network")
                                .onClick(() => this.openFileInMindMapViewer(file));
                        });
                    }

                    if (this.isMarkdownFile(file)) {
                        menu.addItem((item) => {
                            item
                                .setTitle("Export to .mindmap.json")
                                .setIcon("download")
                                .onClick(() => this.exportMarkdownFileToMindMap(file));
                        });
                    }

                    if (this.isMindMapFile(file)) {
                        menu.addItem((item) => {
                            item
                                .setTitle("Open as Text / Raw JSON")
                                .setIcon("code")
                                .onClick(() => this.openFileAsRawJson(file));
                        });
                    }
                } else if (file instanceof TFolder) {
                    menu.addItem((item) => {
                        item
                            .setTitle("New MindMap JSON File")
                            .setIcon("file-plus")
                            .onClick(() => this.createNewMindMapFile(file.path));
                    });
                }
            })
        );

        // 6. Register Commands
        this.addCommand({
            id: "open-active-file-as-mindmap",
            name: "Open active file as Mind Map",
            callback: () => {
                this.debugWorkspaceState();
                const targetFile = this.getActiveMindMapCompatibleFile();
                if (targetFile) {
                    void this.openFileInMindMapViewer(targetFile);
                } else {
                    new Notice("No active MindMap (.mindmap.json), JSON, or Markdown (.md) file found.");
                }
            },
        });

        this.addCommand({
            id: "export-active-markdown-to-mindmap",
            name: "Export active Markdown note to .mindmap.json",
            callback: () => {
                const activeFile = this.getCurrentVaultFile();
                if (activeFile && this.isMarkdownFile(activeFile)) {
                    void this.exportMarkdownFileToMindMap(activeFile);
                } else {
                    new Notice("Please open or select a Markdown (.md) note to export as .mindmap.json.");
                }
            },
        });

        this.addCommand({
            id: "refresh-current-mindmap",
            name: "Refresh current Mind Map",
            checkCallback: (checking) => {
                const activeLeaf = this.app.workspace.getActiveViewOfType(MindMapFileView);
                if (activeLeaf) {
                    if (!checking) {
                        activeLeaf.reloadViewer();
                    }
                    return true;
                }
                return false;
            },
        });

        this.addCommand({
            id: "create-new-mindmap-file",
            name: "Create new MindMap JSON file",
            callback: () => this.createNewMindMapFile(),
        });

        // Ribbon Icon shortcut
        this.addRibbonIcon("network", "Open MindMap Viewer", () => {
            this.debugWorkspaceState();
            const activeFile = this.getActiveMindMapCompatibleFile();
            if (activeFile) {
                void this.openFileInMindMapViewer(activeFile);
            } else {
                new Notice("No active MindMap (.mindmap.json), JSON, or Markdown (.md) file found.");
            }
        });
    }

    async onunload(): Promise<void> {
        for (const timerId of this.bypassAutoMindMapPaths.values()) {
            window.clearTimeout(timerId);
        }
        this.bypassAutoMindMapPaths.clear();
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_MINDMAP);
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    public markBypassAutoMindMap(filePath: string): void {
        const prevTimer = this.bypassAutoMindMapPaths.get(filePath);
        if (prevTimer !== undefined) {
            window.clearTimeout(prevTimer);
        }
        const timerId = window.setTimeout(() => {
            this.bypassAutoMindMapPaths.delete(filePath);
        }, 1500);
        this.bypassAutoMindMapPaths.set(filePath, timerId);
    }

    public isMindMapFile(file: TFile | null): boolean {
        if (!file) return false;
        return file.name.toLowerCase().endsWith(".mindmap.json");
    }

    public isJsonFile(file: TFile | null): boolean {
        if (!file) return false;
        return file.extension.toLowerCase() === "json";
    }

    public isMarkdownFile(file: TFile | null): boolean {
        if (!file) return false;
        return file.extension.toLowerCase() === "md";
    }

    public debugWorkspaceState(): void {
        if (!this.settings.debugMode) return;

        const workspace = this.app.workspace;
        const activeView = workspace.getActiveViewOfType(FileView);
        console.log("=== DIAGNOSTICS: Workspace State ===");
        console.log("1. workspace.getActiveFile():", workspace.getActiveFile()?.path);
        console.log("2. workspace.getActiveViewOfType(FileView)?.file:", activeView?.file?.path);
        const mostRecentLeafFile =
            workspace.getMostRecentLeaf()?.view && "file" in workspace.getMostRecentLeaf()!.view
                ? (workspace.getMostRecentLeaf()!.view as any).file
                : undefined;
        console.log(
            "3. workspace.getMostRecentLeaf()?.view?.file:",
            mostRecentLeafFile instanceof TFile ? mostRecentLeafFile.path : mostRecentLeafFile
        );

        const activeFile = this.getCurrentVaultFile();
        console.log(
            "4. Resolved active file:",
            activeFile
                ? {
                      name: activeFile.name,
                      path: activeFile.path,
                      extension: activeFile.extension,
                  }
                : null
        );

        workspace.iterateAllLeaves((leaf) => {
            const leafFile = "file" in leaf.view ? (leaf.view as any).file : null;
            console.log(`Leaf: viewType=${leaf.view.getViewType()}, file=${leafFile?.path}, name=${leafFile?.name}`);
        });
        console.log("=== END DIAGNOSTICS ===");
    }

    public getCurrentVaultFile(): TFile | null {
        const workspace = this.app.workspace;

        // Priority 1: active FileView file via getActiveViewOfType(FileView)
        const activeFileView = workspace.getActiveViewOfType(FileView);
        if (activeFileView && activeFileView.file instanceof TFile) {
            return activeFileView.file;
        }

        // Priority 2: active file if available via getActiveFile()
        const activeFile = workspace.getActiveFile();
        if (activeFile instanceof TFile) {
            return activeFile;
        }

        // Priority 3: recent leaf as fallback
        const mostRecentLeaf = workspace.getMostRecentLeaf();
        if (mostRecentLeaf && mostRecentLeaf.view && "file" in mostRecentLeaf.view) {
            const file = (mostRecentLeaf.view as any).file;
            if (file instanceof TFile) {
                return file;
            }
        }

        return null;
    }

    public getActiveJsonFile(): TFile | null {
        const file = this.getCurrentVaultFile();
        if (file && (this.isMindMapFile(file) || this.isJsonFile(file))) {
            return file;
        }
        return null;
    }

    public getActiveMindMapCompatibleFile(): TFile | null {
        const file = this.getCurrentVaultFile();
        if (file && (this.isMindMapFile(file) || this.isJsonFile(file) || this.isMarkdownFile(file))) {
            return file;
        }
        return null;
    }

    private getLeafForFile(file: TFile): WorkspaceLeaf | null {
        let foundLeaf: WorkspaceLeaf | null = null;
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof FileView && leaf.view.file?.path === file.path) {
                foundLeaf = leaf;
            }
        });
        return foundLeaf || this.app.workspace.getMostRecentLeaf();
    }

    private scanAndConvertMindMapLeaves(): void {
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof FileView && leaf.view.file && this.isMindMapFile(leaf.view.file)) {
                if (leaf.view.getViewType() !== VIEW_TYPE_MINDMAP) {
                    void this.openFileInMindMapViewer(leaf.view.file, leaf);
                }
            }
        });
    }

    public async openFileInMindMapViewer(file: TFile, targetLeaf?: WorkspaceLeaf | null): Promise<void> {
        let leaf = targetLeaf;

        if (!leaf) {
            // Find existing MindMap leaf for this file if already open
            leaf =
                this.app.workspace
                    .getLeavesOfType(VIEW_TYPE_MINDMAP)
                    .find((l) => l.view instanceof MindMapFileView && l.view.file?.path === file.path) || null;
        }

        if (!leaf) {
            // For Markdown files, open in a beside split if openNoteInNewLeaf is enabled so the note editor remains open
            const activeFileView = this.app.workspace.getActiveViewOfType(FileView);
            if (this.isMarkdownFile(file) && this.settings.openNoteInNewLeaf) {
                leaf = this.app.workspace.getLeaf("split");
            } else if (activeFileView && activeFileView.file?.path === file.path) {
                leaf = activeFileView.leaf;
            } else {
                leaf = this.app.workspace.getLeaf(false);
            }
        }

        this.rawEditorLeaves.delete(leaf);

        await leaf.setViewState({
            type: VIEW_TYPE_MINDMAP,
            state: { file: file.path },
            active: true,
        });

        this.app.workspace.revealLeaf(leaf);
    }

    public async openFileAsRawJson(file: TFile, targetLeaf?: WorkspaceLeaf | null): Promise<void> {
        this.markBypassAutoMindMap(file.path);
        const leaf = targetLeaf || this.app.workspace.getLeaf(false);
        this.rawEditorLeaves.add(leaf);

        try {
            await leaf.setViewState({
                type: "markdown",
                state: { file: file.path, mode: "source" },
                active: true,
            });
            this.app.workspace.revealLeaf(leaf);
        } catch {
            this.markBypassAutoMindMap(file.path);
            await leaf.openFile(file, { active: true });
        }
    }

    public async exportMarkdownFileToMindMap(file: TFile): Promise<void> {
        try {
            const rawMarkdown = await this.app.vault.read(file);
            const parentName = file.parent?.name || "Obsidian Vault";
            const compiled = convertMarkdownToMindMapData(rawMarkdown, file.basename, file.path, parentName);
            const jsonText = JSON.stringify(compiled, null, 2);

            const parentPrefix = file.parent && file.parent.path !== "/" ? `${file.parent.path}/` : "";
            const targetPath = normalizePath(`${parentPrefix}${file.basename}.mindmap.json`);

            let targetFile: TFile;
            const existing = this.app.vault.getAbstractFileByPath(targetPath);
            if (existing instanceof TFile) {
                await this.app.vault.modify(existing, jsonText);
                targetFile = existing;
                new Notice(`Updated ${targetFile.name}`);
            } else {
                targetFile = await this.app.vault.create(targetPath, jsonText);
                new Notice(`Created ${targetFile.name}`);
            }

            await this.openFileInMindMapViewer(targetFile);
        } catch (err) {
            new Notice(`Error exporting MindMap JSON: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    private async createNewMindMapFile(parentFolderPath?: string): Promise<void> {
        const timestamp = Date.now();
        const fileName = `mindmap-${timestamp}.mindmap.json`;
        const initialContent = JSON.stringify(
            {
                id: `mindmap-${timestamp}`,
                title: "New Study Mind Map",
                subtitle: "Interactive Concept Graph • Obsidian Bridge",
                subject: "General Studies",
                language: "en",
                root: {
                    id: "root-concept",
                    label: "Central Topic",
                    subtitle: "Core thesis & foundational overview",
                    description: "Double-check or edit this .mindmap.json file in Obsidian to add branches, keyFacts, tags, and quiz questions.",
                    category: "core",
                    badge: "2 Branches",
                    tags: ["Obsidian", "MindMap"],
                    keyFacts: [
                        "Click any node to inspect its details in the Porcelain Inspector panel.",
                        "Press Cmd/Ctrl + Enter (or click 'Obsidian में खोलें') to jump to the linked vault note."
                    ],
                    children: [
                        {
                            id: "branch-1",
                            label: "Primary Concept A",
                            subtitle: "Key sub-topic & mechanism",
                            description: "Detailed notes for Primary Concept A rendered inside the side inspector.",
                            category: "branch",
                            badge: "High Yield",
                            tags: ["ConceptA"],
                            keyFacts: [
                                "First high-yield checkpoint for Active Recall.",
                                "Second synthesis point for revision."
                            ]
                        },
                        {
                            id: "branch-2",
                            label: "Primary Concept B",
                            subtitle: "Comparative analysis & applications",
                            description: "Detailed notes for Primary Concept B.",
                            category: "branch",
                            tags: ["ConceptB"],
                            keyFacts: [
                                "Core application and exam takeaway."
                            ]
                        }
                    ]
                },
                quizQuestions: [
                    {
                        id: "q-1",
                        nodeId: "branch-1",
                        nodeLabel: "Primary Concept A",
                        question: "Which shortcut opens the currently selected Mind Map node directly in Obsidian?",
                        options: [
                            "Cmd/Ctrl + Enter",
                            "Alt + F4",
                            "Shift + Space",
                            "Ctrl + P"
                        ],
                        correctAnswerIndex: 0,
                        explanation: "Pressing Cmd/Ctrl + Enter (or clicking 'Obsidian में खोलें') sends an OPEN_NOTE message to the Obsidian MindMap Bridge plugin."
                    }
                ]
            },
            null,
            2
        );

        let targetPath: string;
        if (parentFolderPath) {
            targetPath = normalizePath(`${parentFolderPath}/${fileName}`);
        } else {
            const activeFile = this.getCurrentVaultFile();
            const parentFolder = this.app.fileManager.getNewFileParent(activeFile?.path ?? "");
            const prefix = parentFolder.path && parentFolder.path !== "/" ? `${parentFolder.path}/` : "";
            targetPath = normalizePath(`${prefix}${fileName}`);
        }

        try {
            const createdFile = await this.app.vault.create(targetPath, initialContent);
            await this.openFileInMindMapViewer(createdFile);
            new Notice(`Created ${createdFile.name}`);
        } catch (err) {
            new Notice(`Error creating file: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
}

