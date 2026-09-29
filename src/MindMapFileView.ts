import { FileView, TFile, WorkspaceLeaf, Notice, ViewStateResult, normalizePath } from "obsidian";
import MindMapBridgePlugin, { VIEW_TYPE_MINDMAP } from "./main";
import { convertMarkdownToMindMapData, findNodeById, MindMapData } from "./markdownParser";
import { sanitizeViewerUrl } from "./Settings";

export class MindMapFileView extends FileView {
    private plugin: MindMapBridgePlugin;
    private iframeEl: HTMLIFrameElement | null = null;
    private loadingEl: HTMLElement | null = null;
    private isViewerReady: boolean = false;
    private currentJsonText: string | null = null;
    private parsedMindMapData: MindMapData | null = null;
    private debounceTimer: number | null = null;
    private loadingFallbackTimer: number | null = null;

    constructor(leaf: WorkspaceLeaf, plugin: MindMapBridgePlugin) {
        super(leaf);
        this.plugin = plugin;
    }

    getViewType(): string {
        return VIEW_TYPE_MINDMAP;
    }

    getDisplayText(): string {
        return this.file ? `${this.file.basename} (Mind Map)` : "MindMap Viewer";
    }

    getIcon(): string {
        return "network";
    }

    private getSafeViewerUrl(): string {
        return sanitizeViewerUrl(this.plugin.settings.viewerUrl);
    }

    private getViewerOrigin(): string {
        try {
            const url = new URL(this.getSafeViewerUrl());
            return url.origin;
        } catch {
            return "https://mindmap.riyasaksena502.workers.dev";
        }
    }

    private isLocalhostOrigin(origin: string): boolean {
        try {
            const parsed = new URL(origin);
            return (
                (parsed.protocol === "http:" || parsed.protocol === "https:") &&
                (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
            );
        } catch {
            return false;
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
        this.addAction("download", "Export as .mindmap.json", () => this.exportCurrentMindMapJson());
        this.addAction("code", "Open as Text / Raw Editor", () => this.openRawJsonEditor());

        // Attach window message listener via Obsidian Component lifecycle for guaranteed cleanup
        this.registerDomEvent(window, "message", this.handleWindowMessage);

        // Create loading state overlay
        this.loadingEl = this.containerEl.createDiv({ cls: "mindmap-bridge-loading" });
        const spinner = this.loadingEl.createDiv({ cls: "mindmap-bridge-spinner" });
        spinner.setAttribute("aria-hidden", "true");
        this.loadingEl.createSpan({ text: "Loading MindMap Studio (WebGL)..." });

        this.iframeEl = document.createElement("iframe");
        this.iframeEl.addClass("mindmap-bridge-iframe");
        this.iframeEl.setAttribute("allow", "fullscreen; clipboard-read; clipboard-write");
        this.iframeEl.setAttribute("allowfullscreen", "true");
        this.iframeEl.setAttribute("referrerpolicy", "no-referrer");

        // Iframe load listener to deliver data if ready and hide loading overlay
        this.iframeEl.addEventListener("load", () => {
            if (this.currentJsonText && this.isViewerReady) {
                this.postDataToViewer(this.currentJsonText);
            }
            if (this.loadingFallbackTimer) {
                window.clearTimeout(this.loadingFallbackTimer);
            }
            this.loadingFallbackTimer = window.setTimeout(() => {
                this.hideLoadingOverlay();
                if (this.currentJsonText && !this.isViewerReady) {
                    this.isViewerReady = true;
                    this.postDataToViewer(this.currentJsonText);
                }
            }, 1200);
        });

        this.iframeEl.src = this.getSafeViewerUrl();
        this.containerEl.appendChild(this.iframeEl);
    }

    private showLoadingOverlay(): void {
        if (this.loadingEl) {
            this.loadingEl.removeClass("is-hidden");
        }
    }

    private hideLoadingOverlay(): void {
        if (this.loadingEl) {
            this.loadingEl.addClass("is-hidden");
        }
    }

    private handleWindowMessage = (event: MessageEvent) => {
        if (!this.iframeEl || !this.iframeEl.contentWindow) return;

        // 1. Protocol & Payload Validation
        if (!event.data || typeof event.data !== "object") {
            return;
        }

        // 2. Strict Origin Validation: HTTPS viewer origin, opaque "null", Capacitor/App scheme, or exact localhost
        const trustedOrigin = this.getViewerOrigin();
        const isTrustedOrigin = event.origin === trustedOrigin;
        const isOpaqueNullOrigin = event.origin === "null";
        const isCapacitorLocalOrigin =
            event.origin.startsWith("capacitor://") ||
            event.origin.startsWith("app://") ||
            event.origin.startsWith("file://") ||
            this.isLocalhostOrigin(event.origin);

        if (!isTrustedOrigin && !isOpaqueNullOrigin && !isCapacitorLocalOrigin) {
            return;
        }

        // 3. Source Validation: prefer exact iframe source. On some privileged/mobile WebViews
        // MessageEvent.source can be null, so accept that only for the exact trusted viewer origin.
        if (event.source !== this.iframeEl.contentWindow && !(event.source === null && isTrustedOrigin)) {
            return;
        }

        // 4. Handle Ready Handshake from Cloud WebGL App
        if (event.data.type === "MINDMAP_VIEWER_READY") {
            this.isViewerReady = true;
            this.hideLoadingOverlay();
            if (this.currentJsonText) {
                this.postDataToViewer(this.currentJsonText);
            }
            return;
        }

        // 5. Handle Bi-Directional Deep-Link Navigation (OPEN_NOTE from Stitch Inspector / ⌘↵)
        if (event.data.action === "OPEN_NOTE" || event.data.type === "OPEN_NOTE") {
            const rawNodeId =
                event.data.nodeId ??
                event.data.id ??
                (event.data.payload && typeof event.data.payload === "object"
                    ? event.data.payload.nodeId
                    : undefined);

            if (typeof rawNodeId === "string" && rawNodeId.trim().length > 0) {
                void this.handleOpenNoteRequest(rawNodeId.trim());
            }
        }
    };

    /**
     * Strips [[WikiLink]] brackets and |Alias suffixes from a node ID or label.
     */
    private stripWikiLinkAndAlias(raw: string): string {
        let cleaned = raw.replace(/^\[\[|\]\]$/g, "").trim();
        const pipeIndex = cleaned.indexOf("|");
        if (pipeIndex !== -1) {
            cleaned = cleaned.substring(0, pipeIndex).trim();
        }
        return cleaned;
    }

    /**
     * Resolves a Mind Map node ID or label to an Obsidian vault note (and optional #heading)
     * and opens it according to user settings.
     */
    private async handleOpenNoteRequest(nodeId: string): Promise<void> {
        const sourcePath = this.file ? this.file.path : "";
        const openInNewLeaf = this.plugin.settings.openNoteInNewLeaf;
        const matchedNode = findNodeById(this.parsedMindMapData?.root, nodeId);

        if (this.plugin.settings.debugMode) {
            console.log("[MindMapBridge] OPEN_NOTE received:", {
                nodeId,
                matchedLabel: matchedNode?.label,
                sourcePath,
            });
        }

        // Clean [[WikiLink|Alias]] and preserve full nested #Heading#Subheading subpath
        const cleanedId = this.stripWikiLinkAndAlias(nodeId);
        const hashIndex = cleanedId.indexOf("#");
        const idLinkPath = hashIndex !== -1 ? cleanedId.substring(0, hashIndex) : cleanedId;
        const idSubpath = hashIndex !== -1 ? cleanedId.substring(hashIndex + 1) : "";
        const normalizedLinkPath = idLinkPath.replace(/\.md$/i, "").trim();

        // Strategy 1: Resolve direct linkpath (e.g. "History/1857-Revolt" or "Note#Section#Sub")
        if (normalizedLinkPath.length > 0) {
            const destById =
                this.app.metadataCache.getFirstLinkpathDest(normalizedLinkPath, sourcePath) ||
                this.app.metadataCache.getFirstLinkpathDest(idLinkPath.trim(), sourcePath);

            if (destById instanceof TFile) {
                const fullLink = idSubpath ? `${destById.path}#${idSubpath}` : destById.path;
                this.plugin.markBypassAutoMindMap(destById.path);
                await this.app.workspace.openLinkText(fullLink, sourcePath, openInNewLeaf);
                new Notice(`Opened note: ${destById.basename}`);
                return;
            }
        }

        // Strategy 2: Resolve by node's display label in the MindMap tree
        if (matchedNode && matchedNode.label) {
            const cleanLabel = this.stripWikiLinkAndAlias(matchedNode.label);
            const destByLabel = this.app.metadataCache.getFirstLinkpathDest(cleanLabel, sourcePath);
            if (destByLabel instanceof TFile) {
                this.plugin.markBypassAutoMindMap(destByLabel.path);
                await this.app.workspace.openLinkText(destByLabel.path, sourcePath, openInNewLeaf);
                new Notice(`Opened note: ${destByLabel.basename}`);
                return;
            }
        }

        // Strategy 3: Case-insensitive basename search across all Markdown files in Vault
        const markdownFiles = this.app.vault.getMarkdownFiles();
        const targetLower = normalizedLinkPath.toLowerCase();
        const labelLower = matchedNode?.label ? this.stripWikiLinkAndAlias(matchedNode.label).toLowerCase() : "";

        const foundMd = markdownFiles.find((f) => {
            const base = f.basename.toLowerCase();
            return base === targetLower || (labelLower.length > 0 && base === labelLower);
        });

        if (foundMd) {
            const fullLink = idSubpath ? `${foundMd.path}#${idSubpath}` : foundMd.path;
            this.plugin.markBypassAutoMindMap(foundMd.path);
            await this.app.workspace.openLinkText(fullLink, sourcePath, openInNewLeaf);
            new Notice(`Opened note: ${foundMd.basename}`);
            return;
        }

        // Strategy 4: If currently viewing a Markdown (.md) file as a Mind Map, jump to its heading in editor
        if (this.file && this.file.extension.toLowerCase() === "md") {
            const headingTarget = idSubpath || (matchedNode?.label ? this.stripWikiLinkAndAlias(matchedNode.label) : "");
            const linkText = headingTarget ? `${this.file.path}#${headingTarget}` : this.file.path;
            this.plugin.markBypassAutoMindMap(this.file.path);
            await this.app.workspace.openLinkText(linkText, sourcePath, openInNewLeaf);
            new Notice(`Opened section in ${this.file.basename}`);
            return;
        }

        // Strategy 5: Auto-create missing note if enabled in Settings, else inform user
        const fallbackTitle = (matchedNode?.label ? this.stripWikiLinkAndAlias(matchedNode.label) : normalizedLinkPath || nodeId)
            .replace(/[\\/:*?"<>|#^\[\]]/g, " ")
            .replace(/\s+/g, " ")
            .trim();

        if (this.plugin.settings.autoCreateMissingNote && fallbackTitle.length > 0) {
            await this.app.workspace.openLinkText(fallbackTitle, sourcePath, openInNewLeaf);
            new Notice(`Created & opened note: ${fallbackTitle}`);
        } else {
            new Notice(
                `No vault note found for "${matchedNode?.label || nodeId}". (Tip: Enable "Auto-create note if missing" in MindMap Bridge settings to create it automatically.)`
            );
        }
    }

    /**
     * Reads a .mindmap.json, .json, or .md file and prepares the JSON payload for the WebGL viewer.
     */
    private async prepareFilePayload(file: TFile): Promise<string> {
        const rawContent = await this.app.vault.read(file);

        if (file.extension.toLowerCase() === "md") {
            const parentName = file.parent?.name || "Obsidian Vault";
            const compiled = convertMarkdownToMindMapData(
                rawContent,
                file.basename,
                file.path,
                parentName
            );
            this.parsedMindMapData = compiled;
            return JSON.stringify(compiled, null, 2);
        }

        try {
            this.parsedMindMapData = JSON.parse(rawContent) as MindMapData;
        } catch {
            this.parsedMindMapData = null;
        }
        return rawContent;
    }

    async onLoadFile(file: TFile): Promise<void> {
        this.file = file;
        try {
            const payload = await this.prepareFilePayload(file);
            this.currentJsonText = payload;

            if (this.isViewerReady) {
                this.postDataToViewer(payload);
            }
        } catch (err) {
            new Notice(`Failed to read MindMap file: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    async onUnloadFile(file: TFile): Promise<void> {
        this.currentJsonText = null;
        this.parsedMindMapData = null;
        if (this.debounceTimer) {
            window.clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        await super.onUnloadFile(file);
    }

    protected async onClose(): Promise<void> {
        this.isViewerReady = false;
        this.currentJsonText = null;
        this.parsedMindMapData = null;
        if (this.debounceTimer) {
            window.clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        if (this.loadingFallbackTimer) {
            window.clearTimeout(this.loadingFallbackTimer);
            this.loadingFallbackTimer = null;
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
                    const payload = await this.prepareFilePayload(this.file);
                    this.currentJsonText = payload;
                    if (this.isViewerReady) {
                        this.postDataToViewer(payload);
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

            // Strictly post to the validated viewer origin (never fallback to wildcard "*")
            try {
                this.iframeEl.contentWindow.postMessage(message, targetOrigin);
            } catch {
                // Ignore if iframe is not ready or origin mismatches
            }
        }
    }

    public reloadViewer(): void {
        this.isViewerReady = false;
        this.showLoadingOverlay();
        if (this.iframeEl) {
            this.iframeEl.src = this.getSafeViewerUrl();
        }
    }

    private async exportCurrentMindMapJson(): Promise<void> {
        if (!this.file || !this.currentJsonText) {
            new Notice("No Mind Map data loaded to export.");
            return;
        }
        if (this.plugin.isMindMapFile(this.file)) {
            new Notice(`${this.file.name} is already a .mindmap.json file.`);
            return;
        }

        const parentPrefix = this.file.parent && this.file.parent.path !== "/" ? `${this.file.parent.path}/` : "";
        const targetPath = normalizePath(`${parentPrefix}${this.file.basename}.mindmap.json`);

        try {
            const existing = this.app.vault.getAbstractFileByPath(targetPath);
            if (existing instanceof TFile) {
                await this.app.vault.modify(existing, this.currentJsonText);
                new Notice(`Updated ${existing.name}`);
            } else {
                const created = await this.app.vault.create(targetPath, this.currentJsonText);
                new Notice(`Exported ${created.name}`);
            }
        } catch (err) {
            new Notice(`Failed to export MindMap JSON: ${err instanceof Error ? err.message : String(err)}`);
        }
    }

    private async openRawJsonEditor(): Promise<void> {
        if (!this.file) return;
        await this.plugin.openFileAsRawJson(this.file, this.leaf);
    }
}


