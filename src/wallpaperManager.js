import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

export class WallpaperManager {
    constructor({
        settings,
        isActive,
        syncDesktopWallpaper,
        cancelScheduledBoundary,
        scheduleNextBoundary,
        refreshSchedule,
    }) {
        this._settings = settings;
        this._isActive = isActive;
        this._syncSystemWallpaper = syncDesktopWallpaper;
        this._cancelScheduleBoundary = cancelScheduledBoundary;
        this._requestScheduleNextBoundary = scheduleNextBoundary;
        this._requestScheduleRefresh = refreshSchedule;

        this._actors = new Set();
        this._destroyingActors = new WeakSet();
        this._currentActor = null;
        this._currentImagePath = null;
        this._transitionSerial = 0;
        this._transitionMs = Math.round(
            settings.get_double("transition-duration") * 1000,
        );
    }

    get currentActor() {
        return this._currentActor;
    }

    get currentImagePath() {
        return this._currentImagePath;
    }

    updateTransitionDuration() {
        if (!this._settings) return;

        this._transitionMs = Math.round(
            this._settings.get_double("transition-duration") * 1000,
        );
    }

    _createActor(imagePath, opacity = 0) {
        const file = Gio.File.new_for_path(imagePath);

        if (!file.query_exists(null))
            throw new Error(`Wallpaper not found: ${imagePath}`);

        const monitor = Main.layoutManager.primaryMonitor;
        const backgroundGroup =
            Main.layoutManager._backgroundGroup ??
            Main.layoutManager.backgroundGroup;

        if (!monitor || !backgroundGroup)
            throw new Error("GNOME background group is unavailable");

        const actor = new St.Widget({
            name: "dynamic-desktop-wallpaper-layer",
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            opacity,
            reactive: false,
            style: `
                background-image: url("${file.get_uri()}");
                background-size: cover;
                background-repeat: no-repeat;
                background-position: center;
            `,
        });

        backgroundGroup.add_child(actor);
        this._actors.add(actor);

        const imageName = GLib.path_get_basename(imagePath);
        actor.connect("destroy", () => {
            this._actors.delete(actor);

            if (this._currentActor === actor) {
                this._currentActor = null;
                this._currentImagePath = null;
            }

            if (!this._destroyingActors.has(actor)) {
                console.warn(
                    `[Dynamic Desktop] Wallpaper actor destroyed externally: ${imageName}`,
                );
            }
        });

        return actor;
    }

    showInitialImage(imagePath) {
        const actor = this._createActor(imagePath);

        this._currentActor = actor;
        this._currentImagePath = imagePath;

        console.log(
            `[Dynamic Desktop] Starting with ` +
                GLib.path_get_basename(imagePath),
        );

        actor.ease({
            opacity: 255,
            duration: this._transitionMs,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: () => {
                if (this._isActive()) this._requestScheduleRefresh();
            },
        });
    }

    _isActorDestroyed(actor) {
        if (!actor) return true;

        try {
            return Boolean(actor._destroyed || actor.is_destroyed?.());
        } catch {
            return true;
        }
    }

    _destroyActor(actor) {
        if (!actor) return;

        if (this._isActorDestroyed(actor)) {
            this._actors.delete(actor);

            if (this._currentActor === actor) {
                this._currentActor = null;
                this._currentImagePath = null;
            }
            return;
        }

        this._destroyingActors.add(actor);

        try {
            if (!this._isActorDestroyed(actor))
                actor.remove_all_transitions();
        } catch (error) {
            logError(error, "[Dynamic Desktop] Could not stop wallpaper actor transitions");
        }

        try {
            if (!this._isActorDestroyed(actor)) actor.destroy();
        } catch (error) {
            logError(error, "[Dynamic Desktop] Could not destroy wallpaper actor");
        } finally {
            this._destroyingActors.delete(actor);
            this._actors.delete(actor);

            if (this._currentActor === actor) {
                this._currentActor = null;
                this._currentImagePath = null;
            }
        }
    }

    transitionTo(imagePath) {
        if (!this._isActive()) return;

        try {
            this._syncSystemWallpaper(imagePath);
        } catch (error) {
            logError(
                error,
                "[Dynamic Desktop] Cannot sync wallpaper before transition",
            );
        }

        this._cancelScheduleBoundary();

        if (imagePath === this._currentImagePath) {
            this._requestScheduleNextBoundary();
            return;
        }

        let nextActor;

        try {
            nextActor = this._createActor(imagePath);
        } catch (error) {
            logError(error, "[Dynamic Desktop] Could not create next frame");
            this._requestScheduleNextBoundary();
            return;
        }

        // Keep both the current frame and the newly-created transition target.
        // _createActor() has already added nextActor to this._actors.
        for (const actor of [...this._actors]) {
            if (actor !== this._currentActor && actor !== nextActor)
                this._destroyActor(actor);
        }

        const previousActor = this._currentActor;
        if (!this._isActorDestroyed(previousActor))
            previousActor.remove_all_transitions();

        const serial = ++this._transitionSerial;
        this._currentActor = nextActor;
        this._currentImagePath = imagePath;

        console.log(
            `[Dynamic Desktop] Transitioning to ` +
                GLib.path_get_basename(imagePath),
        );

        nextActor.ease({
            opacity: 255,
            duration: this._transitionMs,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: () => {
                if (!this._isActive() || serial !== this._transitionSerial)
                    return;

                if (previousActor) this._destroyActor(previousActor);

                console.log("[Dynamic Desktop] Crossfade completed");
                this._requestScheduleRefresh();
            },
        });
    }

    previewTo(imagePath, onComplete) {
        if (!this._isActive()) return false;

        const previousActor = this._currentActor;

        for (const actor of [...this._actors]) {
            if (actor !== previousActor) this._destroyActor(actor);
        }

        let nextActor;

        try {
            nextActor = this._createActor(imagePath, 0);
        } catch (error) {
            logError(error, "[Dynamic Desktop] Cannot show preview");
            this._requestScheduleNextBoundary();
            return false;
        }

        if (!this._isActorDestroyed(previousActor))
            previousActor.remove_all_transitions();

        const serial = ++this._transitionSerial;
        this._currentActor = nextActor;
        this._currentImagePath = imagePath;

        console.log(
            `[Dynamic Desktop] Previewing ${GLib.path_get_basename(imagePath)}`,
        );

        nextActor.ease({
            opacity: 255,
            duration: this._transitionMs,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: () => {
                if (!this._isActive() || serial !== this._transitionSerial)
                    return;

                if (previousActor) this._destroyActor(previousActor);

                onComplete();
            },
        });

        return true;
    }

    _removeAllActors() {
        for (const actor of [...this._actors]) this._destroyActor(actor);

        this._actors.clear();
        this._currentActor = null;
        this._currentImagePath = null;
    }

    disable() {
        this._transitionSerial++;
        this._removeAllActors();

        this._settings = null;
        this._syncSystemWallpaper = null;
        this._cancelScheduleBoundary = null;
        this._requestScheduleNextBoundary = null;
        this._requestScheduleRefresh = null;
    }
}
