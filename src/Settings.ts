import { App, PluginSettingTab, Setting } from "obsidian";
import MindMapBridgePlugin from "./main";

export interface MindMapBridgeSettings {
    viewerUrl: string;
    autoRefreshOnSave: boolean;
    debounceMs: number;
}

export const DEFAULT_SETTINGS: MindMapBridgeSettings = {
    viewerUrl: "https://mindmap.riyasaksena502.workers.dev",
    autoRefreshOnSave: true,
    debounceMs: 300,
};

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
            .setDesc("Cloudflare-hosted Mind Map Viewer endpoint")
            .addText((text) =>
                text
                    .setPlaceholder("https://mindmap.riyasaksena502.workers.dev")
                    .setValue(this.plugin.settings.viewerUrl)
                    .onChange(async (value) => {
                        this.plugin.settings.viewerUrl = value.trim() || DEFAULT_SETTINGS.viewerUrl;
                        await this.plugin.saveSettings();
                    })
            );

        new Setting(containerEl)
            .setName("Auto-refresh on save")
            .setDesc("Automatically update the Mind Map view when the local JSON file is saved")
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
            .setDesc("Delay in milliseconds before sending updated JSON to viewer on file edit")
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
    }
}
