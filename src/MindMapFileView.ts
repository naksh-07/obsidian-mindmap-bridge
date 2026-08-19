import { FileView, TFile, WorkspaceLeaf, Notice, ViewStateResult } from "obsidian";
import MindMapBridgePlugin, { VIEW_TYPE_MINDMAP } from "./main";

export class MindMapFileView extends FileView {
    private plugin: MindMapBridgePlugin;
    private iframeEl: HTMLIFrameElement | null = null;
    private isViewerReady: boolean = false;
    private currentJsonText: string | null = null;
    private debounceTimer: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: MindMapBridgePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_MINDMAP;
    }

    getDisplayText(): string {
        return this.file ? this.file.basename : "MindMap Viewer";
    }

    private getViewerOrigin(): string {
        try {
            const url = new URL(this.plugin.settings.viewerUrl);
            return url.origin;
        } catch {
            return "https://mindmap.riyasaksena502.workers.dev";
        }
    }

    async setState(state: any, result: ViewStateResult): Promise<void> {
        await super.setState(state, result);
        if (state && typeof state.file === "string" && state.file.length > 0) {
            const abstractFile = this.app.vault.getAbstractFileByPath(state.file);
            if (abstractFile instanceof TFile) {
                this.file = abstractFile;
                await this.onLoadFile(abstractFile);
            }
        }
    }

    getState(): Record<string, unknown> {
        const state = super.getState();
        state.file = this.file ? this.file.path : "";
        return state;
    }

    protected async onOpen(): Promise<void> {
        this.containerEl.empty();
        this.containerEl.addClass("mindmap-bridge-view");

        // Header toolbar actions
        this.addAction("refresh-cw", "Reload MindMap Viewer", () => this.reloadViewer());
        this.addAction("code", "Open as Text / Raw JSON", () => this.openRawJsonEditor());

        // Attach window message listener before iframe src load
        window.addEventListener("message", this.handleWindowMessage);

        this.iframeEl = document.createElement("iframe");
        this.iframeEl.addClass("mindmap-bridge-iframe");

        // Iframe load listener to deliver data if ready and text loaded
        this.iframeEl.addEventListener("load", () => {
            if (this.currentJsonText && this.isViewerReady) {
                this.postDataToViewer(this.currentJsonText);
            }
        });

        this.iframeEl.src = this.plugin.settings.viewerUrl;
        this.containerEl.appendChild(this.iframeEl);
    }

    private handleWindowMessage = (event: MessageEvent) => {
        if (!this.iframeEl || !this.iframeEl.contentWindow) return;

        // 1. Protocol & Payload Validation
        if (!event.data || typeof event.data !== "object") {
            return;
        }

        // 2. Origin Validation: HTTPS viewer origin, opaque "null", or Capacitor local scheme origins
        const trustedOrigin = this.getViewerOrigin();
        const isTrustedOrigin = event.origin === trustedOrigin;
        const isOpaqueNullOrigin = event.origin === "null";
        const isCapacitorLocalOrigin =
            event.origin.startsWith("capacitor://") ||
            event.origin.startsWith("app://") ||
            event.origin.startsWith("file://") ||
            event.origin.includes("localhost");

        if (!isTrustedOrigin && !isOpaqueNullOrigin && !isCapacitorLocalOrigin) {
            return;
        }

        // 3. Source Validation: prefer exact iframe source. On some privileged/mobile WebViews
        // MessageEvent.source can be null, so accept that only for the exact trusted viewer origin.
        if (event.source !== this.iframeEl.contentWindow && !(event.source === null && isTrustedOrigin)) {
            return;
        }

        if (event.data.type === "MINDMAP_VIEWER_READY") {
            this.isViewerReady = true;
            if (this.currentJsonText) {
                this.postDataToViewer(this.currentJsonText);
            }
        }
    };

    async onLoadFile(file: TFile): Promise<void> {
        this.file = file;
        try {
            const content = await this.app.vault.read(file);
            this.currentJsonText = content;

            if (this.isViewerReady) {
                this.postDataToViewer(content);
            }
        } catch (err) {
            new Notice(`Failed to read MindMap file: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    async onUnloadFile(file: TFile): Promise<void> {
        this.currentJsonText = null;
        if (this.debounceTimer) {
            window.clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        await super.onUnloadFile(file);
    }

    protected async onClose(): Promise<void> {
        window.removeEventListener("message", this.handleWindowMessage);
        this.isViewerReady = false;
        this.currentJsonText = null;
        if (this.debounceTimer) {
            window.clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.iframeEl) {
            this.iframeEl.remove();
            this.iframeEl = null;
        }
    }

    public handleFileModification(file: TFile): void {
        if (this.file && file.path === this.file.path) {
            if (this.debounceTimer) {
                window.clearTimeout(this.debounceTimer);
            }
            this.debounceTimer = window.setTimeout(async () => {
                if (this.file && this.file.path === file.path) {
                    const content = await this.app.vault.read(this.file);
                    this.currentJsonText = content;
                    if (this.isViewerReady) {
                        this.postDataToViewer(content);
                    }
                }
            }, this.plugin.settings.debounceMs);
        }
    }

    public postDataToViewer(jsonString: string): void {
        if (this.iframeEl && this.iframeEl.contentWindow) {
            const targetOrigin = this.getViewerOrigin();
            const message = {
                type: "MINDMAP_DATA",
                version: 1,
                payload: jsonString,
            };

            // Post with exact trusted target origin
            try {
                this.iframeEl.contentWindow.postMessage(message, targetOrigin);
            } catch {
                // Ignore if browser throws
            }
        }
    }

    public reloadViewer(): void {
        this.isViewerReady = false;
        if (this.iframeEl) {
            this.iframeEl.src = this.plugin.settings.viewerUrl;
        }
    }

    private async openRawJsonEditor(): Promise<void> {
        if (!this.file) return;
        await this.plugin.openFileAsRawJson(this.file, this.leaf);
    }
}
