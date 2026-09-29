import { App, PluginSettingTab, Setting } from "obsidian";
import MindMapBridgePlugin from "./main";

export interface MindMapBridgeSettings {
    viewerUrl: string;
    autoRefreshOnSave: boolean;
    debounceMs: number;
    openNoteInNewLeaf: boolean;
    autoCreateMissingNote: boolean;
    debugMode: boolean;
}

export const DEFAULT_SETTINGS: MindMapBridgeSettings = {
    viewerUrl: "https://mindmap.riyasaksena502.workers.dev",
    autoRefreshOnSave: true,
    debounceMs: 300,
    openNoteInNewLeaf: true,
    autoCreateMissingNote: false,
    debugMode: false,
};

/**
 * Validates that a viewer URL uses https:// (or http://localhost / 127.0.0.1 for local dev).
 * Falls back to DEFAULT_SETTINGS.viewerUrl if invalid or unsafe (e.g. javascript:, data:).
 */
export function sanitizeViewerUrl(rawUrl: string): string {
    const trimmed = (rawUrl || "").trim();
    if (!trimmed) return DEFAULT_SETTINGS.viewerUrl;
    try {
        const parsed = new URL(trimmed);
        const isHttps = parsed.protocol === "https:";
        const isLocalDevHttp =
            parsed.protocol === "http:" &&
            (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1");
        if (isHttps || isLocalDevHttp) {
            return parsed.toString().replace(/\/$/, "");
        }
    } catch {
        // Fall through to default
    }
    return DEFAULT_SETTINGS.viewerUrl;
}

export class MindMapBridgeSettingTab extends PluginSettingTab {
    plugin: MindMapBridgePlugin;

    constructor(app: App, plugin: MindMapBridgePlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "MindMap Bridge Settings" });

        new Setting(containerEl)
            .setName("Viewer URL")
            .setDesc("Cloudflare-hosted MindMap Studio WebGL endpoint (https:// or http://localhost)")
            .addText((text) =>
                text
                    .setPlaceholder("https://mindmap.riyasaksena502.workers.dev")
                    .setValue(this.plugin.settings.viewerUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.viewerUrl = sanitizeViewerUrl(value);
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Open linked notes in new split/tab")
            .setDesc("When clicking 'Obsidian में खोलें' (⌘↵) inside the Mind Map inspector, open the target note in a beside split/tab so the WebGL canvas stays open")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.openNoteInNewLeaf)
                    .onChange(async (value) => {
                        this.plugin.settings.openNoteInNewLeaf = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Auto-create note if missing on Open")
            .setDesc("If a Mind Map node does not match an existing vault note, automatically create a new Markdown note for that concept when 'Open in Obsidian' is clicked")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.autoCreateMissingNote)
                    .onChange(async (value) => {
                        this.plugin.settings.autoCreateMissingNote = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Auto-refresh on save")
            .setDesc("Automatically update the Mind Map view when the local JSON or Markdown file is saved")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.autoRefreshOnSave)
                    .onChange(async (value) => {
                        this.plugin.settings.autoRefreshOnSave = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Debounce buffer (ms)")
            .setDesc("Delay in milliseconds before sending updated data to viewer on file edit")
            .addSlider((slider) =>
                slider
                    .setLimits(100, 1000, 50)
                    .setValue(this.plugin.settings.debounceMs)
                    .setDynamicTooltip()
                    .onChange(async (value) => {
                        this.plugin.settings.debounceMs = value;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Debug logging")
            .setDesc("Print workspace leaf and postMessage bridge diagnostics to the developer console")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.debugMode)
                    .onChange(async (value) => {
                        this.plugin.settings.debugMode = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}

