import Gio from "gi://Gio";

export class SettingsController {
    constructor(extension) {
        this._extension = extension;
        this._settingsSignals = [];
        this._desktopAppearanceSettings = null;
        this._desktopAppearanceChangedId = 0;
    }

    connect() {
        const extension = this._extension;
        const settings = extension._settings;

        this._desktopAppearanceSettings = new Gio.Settings({
            schema_id: "org.gnome.desktop.interface",
        });
        this._desktopAppearanceChangedId =
            this._desktopAppearanceSettings.connect(
                "changed::color-scheme",
                () => {
                    if (
                        extension._active &&
                        extension._settings &&
                        extension._settings.get_string("schedule-mode") ===
                            "appearance"
                    ) {
                        extension._scheduleController._refreshSchedule();
                        extension._desktopWallpaperSync._queueDesktopWallpaperSync(
                            1500,
                        );
                    }
                },
            );

        this._connect("changed::transition-duration", () =>
            extension._wallpaperManager.updateTransitionDuration(),
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
                extension._scheduleController._queueReload(),
            );
        }

        this._connect("changed::preview-image", () =>
            extension._previewController._handlePreviewRequest(),
        );
    }

    _connect(signal, callback) {
        const id = this._extension._settings.connect(signal, callback);
        this._settingsSignals.push(id);
    }

    isDark() {
        return (
            this._desktopAppearanceSettings.get_string("color-scheme") ===
            "prefer-dark"
        );
    }

    disable() {
        const settings = this._extension._settings;

        if (settings) {
            for (const id of this._settingsSignals) {
                if (id) settings.disconnect(id);
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
    }
}
