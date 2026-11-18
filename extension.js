import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

import { DesktopWallpaperSync } from "./src/desktopWallpaperSync.js";
import { PreviewController } from "./src/previewController.js";
import { ScheduleController } from "./src/scheduleController.js";
import { SettingsController } from "./src/settingsController.js";
import { SolarController } from "./src/solarController.js";
import { WallpaperManager } from "./src/wallpaperManager.js";

export default class DynamicDesktopExtension extends Extension {
    enable() {
        this._active = true;

        this._settings = this.getSettings();

        this._wallpaperManager = new WallpaperManager(this);
        this._desktopWallpaperSync = new DesktopWallpaperSync(this);
        this._solarController = new SolarController(this);
        this._scheduleController = new ScheduleController(this);
        this._previewController = new PreviewController(this);
        this._settingsController = new SettingsController(this);

        this._settingsController.connect();
        this._scheduleController.load();
    }

    disable() {
        this._active = false;

        this._settingsController?.disable();

        this._previewController?.disable();
        this._scheduleController?.disable();
        this._solarController?.disable();
        this._desktopWallpaperSync?.disable();
        this._wallpaperManager?.disable();

        this._settings = null;
    }
}
