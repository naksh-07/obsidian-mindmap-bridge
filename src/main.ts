import { Plugin, TFile, TFolder, WorkspaceLeaf, FileView, normalizePath, Notice } from "obsidian";
import { MindMapFileView } from "./MindMapFileView";
import { MindMapBridgeSettings, DEFAULT_SETTINGS, MindMapBridgeSettingTab } from "./Settings";

export const VIEW_TYPE_MINDMAP = "mindmap-json-view";

export default class MindMapBridgePlugin extends Plugin {
    settings!: MindMapBridgeSettings;

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
                    // Check if file is already displayed in a MindMap view leaf
                    const existingMindMapLeaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP).find(
                        (l) => l.view instanceof MindMapFileView && l.view.file?.path === file.path
                    );
                    if (existingMindMapLeaf) {
                        this.app.workspace.revealLeaf(existingMindMapLeaf);
                        return;
                    }

                    // Find active FileView displaying this file
                    const activeFileView = this.app.workspace.getActiveViewOfType(FileView);
                    const targetLeaf = (activeFileView && activeFileView.file?.path === file.path)
                        ? activeFileView.leaf
                        : this.getLeafForFile(file);

                    if (targetLeaf && targetLeaf.view.getViewType() !== VIEW_TYPE_MINDMAP) {
                        this.openFileInMindMapViewer(file, targetLeaf);
                    }
                }
            })
        );

        // Scan leaves on layout ready to convert any open *.mindmap.json leaves to MindMapFileView
        this.app.workspace.onLayoutReady(() => {
            this.scanAndConvertMindMapLeaves();
        });

        // 5. Register Context Menu Entry for File Explorer
        this.registerEvent(
            this.app.workspace.on("file-menu", (menu, file) => {
                if (file instanceof TFile) {
                    if (this.isMindMapFile(file) || this.isJsonFile(file)) {
                        menu.addItem((item) => {
                            item
                                .setTitle("Open as Mind Map")
                                .setIcon("network")
                                .onClick(() => this.openFileInMindMapViewer(file));
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
                const targetFile = this.getActiveJsonFile();
                if (targetFile) {
                    this.openFileInMindMapViewer(targetFile);
                } else {
                    new Notice("No active JSON or MindMap file found. Please select or open a file first.");
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
            const activeFile = this.getActiveJsonFile();
            if (activeFile) {
                this.openFileInMindMapViewer(activeFile);
            } else {
                new Notice("No active JSON or MindMap file found. Please select or open a file first.");
            }
        });
    }

    async onunload(): Promise<void> {
        this.app.workspace.detachLeavesOfType(VIEW_TYPE_MINDMAP);
    }

    async loadSettings(): Promise<void> {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings(): Promise<void> {
        await this.saveData(this.settings);
    }

    public isMindMapFile(file: TFile | null): boolean {
        if (!file) return false;
        return file.name.toLowerCase().endsWith(".mindmap.json");
    }

    public isJsonFile(file: TFile | null): boolean {
        if (!file) return false;
        return file.extension.toLowerCase() === "json";
    }

    public debugWorkspaceState(): void {
        const workspace = this.app.workspace;
        const activeView = workspace.getActiveViewOfType(FileView);
        console.log("=== DIAGNOSTICS: Workspace State ===");
        console.log("1. workspace.getActiveFile():", workspace.getActiveFile()?.path);
        console.log("2. workspace.getActiveViewOfType(FileView)?.file:", activeView?.file?.path);
        const mostRecentLeafFile = workspace.getMostRecentLeaf()?.view && "file" in workspace.getMostRecentLeaf()!.view ? (workspace.getMostRecentLeaf()!.view as any).file : undefined;
        console.log("3. workspace.getMostRecentLeaf()?.view?.file:", mostRecentLeafFile instanceof TFile ? mostRecentLeafFile.path : mostRecentLeafFile);
        
        const activeFile = this.getCurrentVaultFile();
        console.log("4. Resolved active file:", activeFile ? {
            name: activeFile.name,
            path: activeFile.path,
            extension: activeFile.extension
        } : null);

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
                    this.openFileInMindMapViewer(leaf.view.file, leaf);
                }
            }
        });
    }

    public async openFileInMindMapViewer(file: TFile, targetLeaf?: WorkspaceLeaf | null): Promise<void> {
        let leaf = targetLeaf;

        if (!leaf) {
            // Find existing MindMap leaf for this file if already open
            leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_MINDMAP).find(
                (l) => l.view instanceof MindMapFileView && l.view.file?.path === file.path
            ) || null;
        }

        if (!leaf) {
            // Use active FileView leaf if it holds this file, otherwise create/get new leaf
            const activeFileView = this.app.workspace.getActiveViewOfType(FileView);
            if (activeFileView && activeFileView.file?.path === file.path) {
                leaf = activeFileView.leaf;
            } else {
                leaf = this.app.workspace.getLeaf(false);
            }
        }

        await leaf.setViewState({
            type: VIEW_TYPE_MINDMAP,
            state: { file: file.path },
            active: true
        });

        this.app.workspace.revealLeaf(leaf);
    }

    public async openFileAsRawJson(file: TFile, targetLeaf?: WorkspaceLeaf | null): Promise<void> {
        const leaf = targetLeaf || this.app.workspace.getLeaf(false);
        await leaf.openFile(file, { active: true });
    }

    private async createNewMindMapFile(parentFolderPath?: string): Promise<void> {
        const fileName = `mindmap-${Date.now()}.mindmap.json`;
        const initialContent = JSON.stringify(
            {
                id: "new-mindmap",
                title: "New Mind Map",
                subject: "General",
                language: "en",
                root: {
                    id: "root",
                    label: "New Mind Map",
                    children: []
                }
            },
            null,
            2
        );

        let targetPath: string;
        if (parentFolderPath) {
            targetPath = normalizePath(`${parentFolderPath}/${fileName}`);
        } else {
            const activeFile = this.getActiveJsonFile();
            const parentFolder = this.app.fileManager.getNewFileParent(activeFile?.path ?? "");
            targetPath = normalizePath(`${parentFolder.path}/${fileName}`);
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
