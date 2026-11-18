import GLib from "gi://GLib";
import { WallpaperSet } from "./wallpaperSet.js";

export class ScheduleController {
    constructor(extension) {
        this._extension = extension;
        this._wallpaperSet = new WallpaperSet(extension);
        this._images = [];
        this._schedule = [];
        this._solarAnchors = null;
        this._appearanceConfig = null;
        this._directory = null;
        this._timeoutId = 0;
        this._reloadTimeoutId = 0;
    }

    get images() {
        return this._images;
    }

    get appearanceConfig() {
        return this._appearanceConfig;
    }

    load() {
        try {
            this._loadImageSet();
        } catch (error) {
            logError(error, "[Dynamic Desktop] Failed to start");
            this._extension._active = false;
            this._extension._settingsController.disable();
            this._extension._previewController.disable();
            this.disable();
            this._extension._solarController.disable();
            this._extension._desktopWallpaperSync.disable();
            this._extension._wallpaperManager.disable();
            this._extension._settings = null;
        }
    }

    _queueReload() {
        if (!this._extension._active) return;

        if (this._reloadTimeoutId) {
            GLib.Source.remove(this._reloadTimeoutId);
            this._reloadTimeoutId = 0;
        }

        this._reloadTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            250,
            () => {
                this._reloadTimeoutId = 0;

                if (this._extension._active) this._reloadSafely();

                return GLib.SOURCE_REMOVE;
            },
        );
    }

    _reloadSafely() {
        if (!this._extension._active) return;

        try {
            this._loadImageSet();
        } catch (error) {
            logError(error, "[Dynamic Desktop] Cannot update wallpaper set");
        }
    }

    _loadImageSet() {
        const result = this._wallpaperSet.load();

        this._directory = result.directory;
        this._images = result.images;
        this._schedule = result.schedule;
        this._solarAnchors = result.solarAnchors ?? null;
        this._appearanceConfig = result.appearance ?? null;

        this._extension._solarController.setAnchors(this._solarAnchors);
        this._extension._desktopWallpaperSync._syncDesktopWallpaper();

        console.log(
            `[Dynamic Desktop] Loaded ${result.images.length} images from ` +
                `${result.directory} (${result.name})`,
        );

        if (!this._extension._wallpaperManager.currentActor) {
            this._extension._wallpaperManager._showInitialImage(
                this._imageForNow(new Date()),
            );
        } else {
            this._refreshSchedule();
        }
    }

    _imageForNow(date) {
        if (this._appearanceConfig) {
            return this._extension._settingsController.isDark()
                ? this._appearanceConfig.dark
                : this._appearanceConfig.light;
        }

        if (this._solarAnchors)
            return this._extension._solarController._solarImageForNow(date);

        const minute = date.getHours() * 60 + date.getMinutes();
        let image = this._schedule[this._schedule.length - 1].image;

        for (const entry of this._schedule) {
            if (minute < entry.minute) break;

            image = entry.image;
        }

        return image;
    }

    _refreshSchedule() {
        if (!this._extension._active) return;

        const desired = this._imageForNow(new Date());

        if (desired !== this._extension._wallpaperManager.currentImagePath) {
            this._extension._wallpaperManager._transitionTo(desired);
            return;
        }

        this._scheduleNextBoundary();
    }

    _nextBoundary(now) {
        const nowMs = now.getTime();

        for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
            for (const entry of this._schedule) {
                const candidate = new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    now.getDate() + dayOffset,
                    Math.floor(entry.minute / 60),
                    entry.minute % 60,
                    0,
                    0,
                );

                if (candidate.getTime() <= nowMs + 25) continue;

                if (
                    entry.image ===
                    this._extension._wallpaperManager.currentImagePath
                )
                    continue;

                return candidate;
            }
        }

        return null;
    }

    cancelScheduledBoundary() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    _scheduleNextBoundary() {
        if (!this._extension._active) return;

        this.cancelScheduledBoundary();

        if (this._solarAnchors) {
            this._extension._solarController.setNextCheck(
                new Date(Date.now() + 60000),
            );

            this._timeoutId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                60,
                () => {
                    this._timeoutId = 0;

                    if (this._extension._active) this._refreshSchedule();

                    return GLib.SOURCE_REMOVE;
                },
            );

            return;
        }

        if (this._appearanceConfig) return;

        const boundary = this._nextBoundary(new Date());

        if (!boundary) return;

        const delay = Math.max(100, boundary.getTime() - Date.now());

        console.log(
            `[Dynamic Desktop] Next transition scheduled for ` +
                `${boundary.toLocaleString()}`,
        );

        this._timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            Math.ceil(delay),
            () => {
                this._timeoutId = 0;

                if (this._extension._active) this._refreshSchedule();

                return GLib.SOURCE_REMOVE;
            },
        );
    }

    disable() {
        this.cancelScheduledBoundary();

        if (this._reloadTimeoutId) {
            GLib.Source.remove(this._reloadTimeoutId);
            this._reloadTimeoutId = 0;
        }
    }
}
