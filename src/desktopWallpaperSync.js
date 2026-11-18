import Gio from "gi://Gio";
import GLib from "gi://GLib";

export class DesktopWallpaperSync {
    constructor(extension) {
        this._extension = extension;
        this._desktopBackgroundSettings = new Gio.Settings({
            schema_id: "org.gnome.desktop.background",
        });
        this._originalDesktopWallpaper = {
            pictureUri:
                this._desktopBackgroundSettings.get_string("picture-uri"),
            pictureUriDark:
                this._desktopBackgroundSettings.get_string("picture-uri-dark"),
        };
        this._lastAppliedDesktopWallpaper = {
            pictureUri: null,
            pictureUriDark: null,
        };
        this._syncTimeoutId = 0;
    }

    _queueDesktopWallpaperSync(delayMs = 1500) {
        if (this._syncTimeoutId) {
            GLib.Source.remove(this._syncTimeoutId);
            this._syncTimeoutId = 0;
        }

        this._syncTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            delayMs,
            () => {
                this._syncTimeoutId = 0;

                if (
                    this._extension._active &&
                    this._extension._settings &&
                    this._extension._settings.get_string("schedule-mode") ===
                        "appearance"
                ) {
                    try {
                        this._syncDesktopWallpaper();
                    } catch (error) {
                        logError(
                            error,
                            "[Dynamic Desktop] Cannot sync system wallpaper",
                        );
                    }
                }

                return GLib.SOURCE_REMOVE;
            },
        );
    }

    _syncDesktopWallpaper(imagePath = null) {
        const desktopSettings = this._desktopBackgroundSettings;

        if (!desktopSettings) return;

        const schedule = this._extension._scheduleController;
        let lightPath;
        let darkPath;

        if (schedule.appearanceConfig) {
            lightPath = schedule.appearanceConfig.light;
            darkPath = schedule.appearanceConfig.dark;
        } else {
            const currentPath =
                imagePath ??
                this._extension._wallpaperManager.currentImagePath ??
                schedule._imageForNow(new Date());

            if (!currentPath) return;

            lightPath = currentPath;
            darkPath = currentPath;
        }

        const lightUri = Gio.File.new_for_path(lightPath).get_uri();
        const darkUri = Gio.File.new_for_path(darkPath).get_uri();
        const updates = [
            ["picture-uri", "pictureUri", lightUri],
            ["picture-uri-dark", "pictureUriDark", darkUri],
        ];
        const changedKeys = [];

        for (const [key, slot, uri] of updates) {
            this._lastAppliedDesktopWallpaper[slot] = uri;

            if (desktopSettings.get_string(key) !== uri) {
                desktopSettings.set_string(key, uri);
                changedKeys.push(key);
            }
        }

        if (changedKeys.length > 0) {
            console.log(
                "[Dynamic Desktop] Synced GNOME wallpaper setting(s): " +
                    changedKeys.join(", "),
            );
        }
    }

    _restoreDesktopWallpaper() {
        const desktopSettings = this._desktopBackgroundSettings;

        if (!desktopSettings) return;

        const original = this._originalDesktopWallpaper;
        const lastApplied = this._lastAppliedDesktopWallpaper;
        const entries = [
            ["picture-uri", "pictureUri"],
            ["picture-uri-dark", "pictureUriDark"],
        ];

        for (const [key, slot] of entries) {
            try {
                const originalUri = original?.[slot];
                const appliedUri = lastApplied?.[slot];

                if (
                    originalUri === undefined ||
                    appliedUri === null ||
                    appliedUri === undefined
                ) {
                    continue;
                }

                const currentUri = desktopSettings.get_string(key);

                if (currentUri === appliedUri && currentUri !== originalUri) {
                    desktopSettings.set_string(key, originalUri);
                }
            } catch (error) {
                logError(error, `[Dynamic Desktop] Cannot restore ${key}`);
            }
        }

        this._desktopBackgroundSettings = null;
        this._originalDesktopWallpaper = null;
        this._lastAppliedDesktopWallpaper = null;
    }

    disable() {
        if (this._syncTimeoutId) {
            GLib.Source.remove(this._syncTimeoutId);
            this._syncTimeoutId = 0;
        }

        this._restoreDesktopWallpaper();
    }
}
