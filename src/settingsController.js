import Gio from "gi://Gio";

export class SettingsController {
    constructor({
        settings,
        isActive,
        scheduleController,
        desktopWallpaperSync,
        wallpaperManager,
        previewController,
    }) {
        this._settings = settings;
        this._isActive = isActive;
        this._scheduleController = scheduleController;
        this._desktopWallpaperSync = desktopWallpaperSync;
        this._wallpaperManager = wallpaperManager;
        this._previewController = previewController;

        this._settingsSignals = [];
        this._desktopAppearanceSettings = null;
        this._desktopAppearanceChangedId = 0;
    }

    connect() {
        this._desktopAppearanceSettings = new Gio.Settings({
            schema_id: "org.gnome.desktop.interface",
        });
        this._desktopAppearanceChangedId =
            this._desktopAppearanceSettings.connect(
                "changed::color-scheme",
                () => {
                    if (
                        this._isActive() &&
                        this._settings &&
                        this._settings.get_string("schedule-mode") === "appearance"
                    ) {
                        this._scheduleController.refresh();
                        this._desktopWallpaperSync.queueSync(1500);
                    }
                },
            );

        this._connect("changed::transition-duration", () =>
            this._wallpaperManager.updateTransitionDuration(),
        );

        for (const key of [
            "wallpaper-directory",
            "schedule-json",
            "schedule-mode",
            "appearance-light-image",
            "appearance-dark-image",
            "latitude",
            "longitude",
            "solar-location-configured",
        ]) {
            this._connect(`changed::${key}`, () =>
                this._scheduleController.queueReload(),
            );
        }

        this._connect("changed::preview-image", () =>
            this._previewController.handlePreviewRequest(),
        );
    }

    _connect(signal, callback) {
        const id = this._settings.connect(signal, callback);
        this._settingsSignals.push(id);
    }

    isDark() {
        return (
            this._desktopAppearanceSettings?.get_string("color-scheme") ===
            "prefer-dark"
        );
    }

    disable() {
        if (this._settings) {
            for (const id of this._settingsSignals) {
                if (id) this._settings.disconnect(id);
            }
        }

        this._settingsSignals = [];

        if (
            this._desktopAppearanceSettings &&
            this._desktopAppearanceChangedId
        ) {
            this._desktopAppearanceSettings.disconnect(
                this._desktopAppearanceChangedId,
            );
        }

        this._desktopAppearanceChangedId = 0;
        this._desktopAppearanceSettings = null;
        this._settings = null;
        this._scheduleController = null;
        this._desktopWallpaperSync = null;
        this._wallpaperManager = null;
        this._previewController = null;
    }
}
