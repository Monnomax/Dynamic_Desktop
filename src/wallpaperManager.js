import Clutter from "gi://Clutter";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import St from "gi://St";
import * as Main from "resource:///org/gnome/shell/ui/main.js";

export class WallpaperManager {
    constructor(extension) {
        this._extension = extension;
        this._actors = new Set();
        this._currentActor = null;
        this._currentImagePath = null;
        this._transitionSerial = 0;
        this._transitionMs = Math.round(
            extension._settings.get_double("transition-duration") * 1000,
        );
    }

    get currentActor() {
        return this._currentActor;
    }

    get currentImagePath() {
        return this._currentImagePath;
    }

    updateTransitionDuration() {
        this._transitionMs = Math.round(
            this._extension._settings.get_double("transition-duration") * 1000,
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

        return actor;
    }

    _showInitialImage(imagePath) {
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
                if (this._extension._active)
                    this._extension._scheduleController._refreshSchedule();
            },
        });
    }

    _destroyActor(actor) {
        if (!actor) return;

        actor.remove_all_transitions();
        actor.destroy();
        this._actors.delete(actor);
    }

    _transitionTo(imagePath) {
        const extension = this._extension;

        if (!extension._active) return;

        try {
            extension._desktopWallpaperSync._syncDesktopWallpaper(imagePath);
        } catch (error) {
            logError(
                error,
                "[Dynamic Desktop] Cannot sync wallpaper before transition",
            );
        }

        extension._scheduleController.cancelScheduledBoundary();

        if (imagePath === this._currentImagePath) {
            extension._scheduleController._scheduleNextBoundary();
            return;
        }

        let nextActor;

        try {
            nextActor = this._createActor(imagePath);
        } catch (error) {
            logError(error, "[Dynamic Desktop] Could not create next frame");
            extension._scheduleController._scheduleNextBoundary();
            return;
        }

        for (const actor of [...this._actors]) {
            if (actor !== this._currentActor) this._destroyActor(actor);
        }

        const previousActor = this._currentActor;
        previousActor?.remove_all_transitions();

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
                if (!extension._active || serial !== this._transitionSerial)
                    return;

                if (previousActor) this._destroyActor(previousActor);

                console.log("[Dynamic Desktop] Crossfade completed");
                extension._scheduleController._refreshSchedule();
            },
        });
    }

    previewTo(imagePath, onComplete) {
        const extension = this._extension;
        const previousActor = this._currentActor;

        for (const actor of [...this._actors]) {
            if (actor !== previousActor) this._destroyActor(actor);
        }

        let nextActor;

        try {
            nextActor = this._createActor(imagePath, 0);
        } catch (error) {
            logError(error, "[Dynamic Desktop] Cannot show preview");
            extension._scheduleController._scheduleNextBoundary();
            return false;
        }

        previousActor?.remove_all_transitions();

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
                if (!extension._active || serial !== this._transitionSerial)
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
    }
}
