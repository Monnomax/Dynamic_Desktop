import GLib from "gi://GLib";

export class ScheduleController {
    constructor({
        settings,
        isActive,
        wallpaperSet,
        solarController,
        wallpaperManager,
        desktopWallpaperSync,
        isDark,
    }) {
        this._settings = settings;
        this._isActive = isActive;
        this._wallpaperSet = wallpaperSet;
        this._solarController = solarController;
        this._wallpaperManager = wallpaperManager;
        this._desktopWallpaperSync = desktopWallpaperSync;
        this._isDark = isDark;

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
        // Startup failures are propagated to the extension lifecycle owner.
        this._loadImageSet();
    }

    queueReload() {
        if (!this._isActive()) return;

        if (this._reloadTimeoutId) {
            GLib.Source.remove(this._reloadTimeoutId);
            this._reloadTimeoutId = 0;
        }

        this._reloadTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            250,
            () => {
                this._reloadTimeoutId = 0;

                if (this._isActive()) this._reloadSafely();

                return GLib.SOURCE_REMOVE;
            },
        );
    }

    _reloadSafely() {
        if (!this._isActive()) return;

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

        this._solarController.setAnchors(this._solarAnchors);
        this._desktopWallpaperSync.sync();

        console.log(
            `[Dynamic Desktop] Loaded ${result.images.length} images from ` +
                `${result.directory} (${result.name})`,
        );

        if (!this._wallpaperManager.currentActor) {
            this._wallpaperManager.showInitialImage(this.imageForNow(new Date()));
        } else {
            this.refresh();
        }
    }

    imageForNow(date) {
        if (this._appearanceConfig)
            return this._isDark()
                ? this._appearanceConfig.dark
                : this._appearanceConfig.light;

        if (this._solarAnchors)
            return this._solarController.imageForNow(date);

        const minute = date.getHours() * 60 + date.getMinutes();
        let image = this._schedule[this._schedule.length - 1].image;

        for (const entry of this._schedule) {
            if (minute < entry.minute) break;

            image = entry.image;
        }

        return image;
    }

    refresh() {
        if (!this._isActive()) return;

        const desired = this.imageForNow(new Date());

        if (desired !== this._wallpaperManager.currentImagePath) {
            this._wallpaperManager.transitionTo(desired);
            return;
        }

        this.scheduleNextBoundary();
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

                if (entry.image === this._wallpaperManager.currentImagePath)
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

    scheduleNextBoundary() {
        if (!this._isActive()) return;

        this.cancelScheduledBoundary();

        if (this._solarAnchors) {
            this._solarController.setNextCheck(new Date(Date.now() + 60000));

            this._timeoutId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                60,
                () => {
                    this._timeoutId = 0;

                    if (this._isActive()) this.refresh();

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

                if (this._isActive()) this.refresh();

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

        this._settings = null;
        this._wallpaperSet = null;
        this._solarController = null;
        this._wallpaperManager = null;
        this._desktopWallpaperSync = null;
        this._isDark = null;
    }
}
