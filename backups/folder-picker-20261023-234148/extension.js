import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import { Extension } from
    'resource:///org/gnome/shell/extensions/extension.js';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

export default class DynamicDesktopExtension extends Extension {
    enable() {
        this._active = true;
        this._actors = new Set();
        this._currentActor = null;
        this._currentImageNumber = null;
        this._timeoutId = 0;

        this._settings = this.getSettings();
        this._transitionMs = Math.round(
            this._settings.get_double('transition-duration') * 1000
        );

        this._settingsChangedId = this._settings.connect(
            'changed::transition-duration',
            () => {
                this._transitionMs = Math.round(
                    this._settings.get_double('transition-duration') * 1000
                );

                console.log(
                    `[Dynamic Desktop] Transition duration updated: ` +
                    `${this._transitionMs / 1000}s`
                );
            }
        );

        this._imageDirectory = GLib.build_filenamev([
            GLib.get_home_dir(),
            'Завантажене',
            'mojave_dynamic',
        ]);

        // Local clock-based schedule.
        // Each entry becomes active at its local wall-clock time.
        this._schedule = [
            { minute: 0,    image: 15 },
            { minute: 180,  image: 16 },
            { minute: 300,  image: 1 },
            { minute: 360,  image: 2 },
            { minute: 420,  image: 3 },
            { minute: 480,  image: 4 },
            { minute: 540,  image: 5 },
            { minute: 600,  image: 6 },
            { minute: 660,  image: 7 },
            { minute: 780,  image: 8 },
            { minute: 840,  image: 9 },
            { minute: 900,  image: 10 },
            { minute: 960,  image: 11 },
            { minute: 1020, image: 12 },
            { minute: 1080, image: 13 },
            { minute: 1200, image: 14 },
            { minute: 1380, image: 15 },
        ];

        try {
            // Start with the wallpaper that corresponds to the current time.
            this._currentImageNumber = this._imageForNow(new Date());
            this._currentActor = this._createActor(
                this._currentImageNumber,
                0
            );

            console.log(
                `[Dynamic Desktop] Starting with Mojave frame ` +
                `${this._currentImageNumber}`
            );

            this._currentActor.ease({
                opacity: 255,
                duration: this._transitionMs,
                mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
                onComplete: () => {
                    if (this._active)
                        this._refreshSchedule();
                },
            });
        } catch (error) {
            logError(error, '[Dynamic Desktop] Failed to start');
            this._disconnectSettings();
            this._removeAllActors();
            this._active = false;
        }
    }

    _imageForNow(date) {
        const minute = date.getHours() * 60 + date.getMinutes();
        let image = this._schedule[0].image;

        for (const entry of this._schedule) {
            if (minute < entry.minute)
                break;

            image = entry.image;
        }

        return image;
    }

    _imagePath(imageNumber) {
        return GLib.build_filenamev([
            this._imageDirectory,
            `mojave_dynamic_${imageNumber}.jpeg`,
        ]);
    }

    _createActor(imageNumber, initialOpacity = 0) {
        const path = this._imagePath(imageNumber);
        const file = Gio.File.new_for_path(path);

        if (!file.query_exists(null))
            throw new Error(`Wallpaper not found: ${path}`);

        const monitor = Main.layoutManager.primaryMonitor;
        const backgroundGroup =
            Main.layoutManager._backgroundGroup ??
            Main.layoutManager.backgroundGroup;

        if (!monitor || !backgroundGroup)
            throw new Error('GNOME background group is unavailable');

        const actor = new St.Widget({
            name: `dynamic-desktop-frame-${imageNumber}`,
            x: monitor.x,
            y: monitor.y,
            width: monitor.width,
            height: monitor.height,
            opacity: initialOpacity,
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

    _refreshSchedule() {
        if (!this._active)
            return;

        // Reconcile against the actual clock, including after suspend.
        const desiredImage = this._imageForNow(new Date());

        if (desiredImage !== this._currentImageNumber) {
            this._transitionTo(desiredImage);
            return;
        }

        this._scheduleNextBoundary();
    }

    _transitionTo(imageNumber) {
        if (!this._active)
            return;

        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }

        if (imageNumber === this._currentImageNumber) {
            this._scheduleNextBoundary();
            return;
        }

        let nextActor;

        try {
            nextActor = this._createActor(imageNumber, 0);
        } catch (error) {
            logError(error, '[Dynamic Desktop] Could not create next frame');
            this._scheduleNextBoundary();
            return;
        }

        const previousActor = this._currentActor;
        this._currentImageNumber = imageNumber;
        this._currentActor = nextActor;

        console.log(
            `[Dynamic Desktop] Transitioning to frame ${imageNumber}`
        );

        nextActor.ease({
            opacity: 255,
            duration: this._transitionMs,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: () => {
                if (!this._active)
                    return;

                if (previousActor && previousActor !== nextActor) {
                    previousActor.remove_all_transitions();
                    previousActor.destroy();
                    this._actors.delete(previousActor);
                }

                // Check again in case the clock changed during the fade.
                this._refreshSchedule();
            },
        });
    }

    _nextBoundary(now) {
        const nowMs = now.getTime();

        // Search today and the following two local calendar days.
        // Using local Date objects also accommodates timezone/DST changes.
        for (let dayOffset = 0; dayOffset <= 2; dayOffset++) {
            for (const entry of this._schedule) {
                const hour = Math.floor(entry.minute / 60);
                const minute = entry.minute % 60;

                const candidate = new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    now.getDate() + dayOffset,
                    hour,
                    minute,
                    0,
                    0
                );

                if (candidate.getTime() <= nowMs + 25)
                    continue;

                // Frame 15 spans midnight, so midnight itself does not
                // require an unnecessary second transition to frame 15.
                if (entry.image === this._currentImageNumber)
                    continue;

                return candidate;
            }
        }

        return null;
    }

    _scheduleNextBoundary() {
        if (!this._active)
            return;

        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }

        const boundary = this._nextBoundary(new Date());

        if (!boundary) {
            console.error('[Dynamic Desktop] No next boundary found');
            return;
        }

        const delay = Math.max(100, boundary.getTime() - Date.now());

        console.log(
            `[Dynamic Desktop] Next transition scheduled for ` +
            `${boundary.toLocaleString()}`
        );

        this._timeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            Math.ceil(delay),
            () => {
                this._timeoutId = 0;

                if (this._active)
                    this._refreshSchedule();

                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _disconnectSettings() {
        if (this._settings && this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }

        this._settings = null;
    }

    _removeAllActors() {
        if (this._actors) {
            for (const actor of this._actors) {
                actor.remove_all_transitions();
                actor.destroy();
            }

            this._actors.clear();
        }

        this._currentActor = null;
    }

    disable() {
        this._active = false;

        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this._disconnectSettings();
        this._removeAllActors();
        this._currentImageNumber = null;

        console.log(
            '[Dynamic Desktop] Disabled; temporary wallpaper layers removed'
        );
    }
}
