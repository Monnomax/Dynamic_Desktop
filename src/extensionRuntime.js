import { DesktopWallpaperSync } from "./desktopWallpaperSync.js";
import { PreviewController } from "./previewController.js";
import { ScheduleController } from "./scheduleController.js";
import { SettingsController } from "./settingsController.js";
import { SolarController } from "./solarController.js";
import { WallpaperManager } from "./wallpaperManager.js";
import { WallpaperSet } from "./wallpaperSet.js";

export class DynamicDesktopRuntime {
    constructor(settings) {
        this._settings = settings;
        this._active = false;

        this._wallpaperManager = null;
        this._desktopWallpaperSync = null;
        this._solarController = null;
        this._scheduleController = null;
        this._previewController = null;
        this._settingsController = null;
    }

    enable() {
        if (this._active) return;

        this._active = true;

        try {
            this._createControllers();
            this._settingsController.connect();
            this._scheduleController.load();
        } catch (error) {
            this._active = false;
            logError(error, "[Dynamic Desktop] Failed to start");
            this._shutdownControllers();
        }
    }

    _createControllers() {
        const settings = this._settings;
        const isActive = () => this._active;

        // Callback dependencies break the runtime cycle without exposing the
        // whole runtime object to individual controllers.
        this._wallpaperManager = new WallpaperManager({
            settings,
            isActive,
            syncDesktopWallpaper: (imagePath) =>
                this._desktopWallpaperSync?.sync(imagePath),
            cancelScheduledBoundary: () =>
                this._scheduleController?.cancelScheduledBoundary(),
            scheduleNextBoundary: () =>
                this._scheduleController?.scheduleNextBoundary(),
            refreshSchedule: () => this._scheduleController?.refresh(),
        });

        this._desktopWallpaperSync = new DesktopWallpaperSync({
            settings,
            isActive,
            getAppearanceConfig: () =>
                this._scheduleController?.appearanceConfig ?? null,
            getCurrentImagePath: () =>
                this._wallpaperManager?.currentImagePath ?? null,
            getScheduledImagePath: () =>
                this._scheduleController?.imageForNow(new Date()) ?? null,
        });

        this._solarController = new SolarController({
            settings,
            getCurrentImagePath: () =>
                this._wallpaperManager?.currentImagePath ?? null,
        });

        this._scheduleController = new ScheduleController({
            settings,
            isActive,
            wallpaperSet: new WallpaperSet(settings),
            solarController: this._solarController,
            wallpaperManager: this._wallpaperManager,
            desktopWallpaperSync: this._desktopWallpaperSync,
            isDark: () => this._settingsController?.isDark() ?? false,
        });

        this._previewController = new PreviewController({
            settings,
            isActive,
            scheduleController: this._scheduleController,
            wallpaperManager: this._wallpaperManager,
        });

        this._settingsController = new SettingsController({
            settings,
            isActive,
            scheduleController: this._scheduleController,
            desktopWallpaperSync: this._desktopWallpaperSync,
            wallpaperManager: this._wallpaperManager,
            previewController: this._previewController,
        });
    }

    _shutdownControllers() {
        // Disconnect producers first, then stop timers and release resources.
        const shutdownSteps = [
            ["settings controller", this._settingsController],
            ["preview controller", this._previewController],
            ["schedule controller", this._scheduleController],
            ["solar controller", this._solarController],
            ["desktop wallpaper sync", this._desktopWallpaperSync],
            ["wallpaper manager", this._wallpaperManager],
        ];

        for (const [name, controller] of shutdownSteps) {
            try {
                controller?.disable();
            } catch (error) {
                logError(error, `[Dynamic Desktop] Failed to stop ${name}`);
            }
        }

        this._settingsController = null;
        this._previewController = null;
        this._scheduleController = null;
        this._solarController = null;
        this._desktopWallpaperSync = null;
        this._wallpaperManager = null;
        this._settings = null;
    }

    disable() {
        if (!this._active && !this._settings) return;

        this._active = false;
        this._shutdownControllers();

        console.log(
            "[Dynamic Desktop] Disabled; temporary wallpaper layers removed",
        );
    }
}
