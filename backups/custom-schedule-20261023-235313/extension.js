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
        this._currentImagePath = null;
        this._timeoutId = 0;
        this._transitionSerial = 0;

        this._settings = this.getSettings();
        this._transitionMs = Math.round(
            this._settings.get_double('transition-duration') * 1000
        );

        this._transitionChangedId = this._settings.connect(
            'changed::transition-duration',
            () => {
                this._transitionMs = Math.round(
                    this._settings.get_double('transition-duration') * 1000
                );

                console.log(
                    `[Dynamic Desktop] Transition duration: ` +
                    `${this._transitionMs / 1000}s`
                );
            }
        );

        this._directoryChangedId = this._settings.connect(
            'changed::wallpaper-directory',
            () => {
                try {
                    this._loadImageSet();
                } catch (error) {
                    logError(error, '[Dynamic Desktop] Cannot load selected folder');
                }
            }
        );

        try {
            this._loadImageSet();
        } catch (error) {
            logError(error, '[Dynamic Desktop] Failed to start');
            this._disconnectSettings();
            this._removeAllActors();
            this._active = false;
        }
    }

    _getDirectory() {
        const configured = this._settings
            .get_string('wallpaper-directory')
            .trim();

        if (configured)
            return configured;

        return GLib.build_filenamev([
            GLib.get_home_dir(),
            'Завантажене',
            'mojave_dynamic',
        ]);
    }

    _readImageSet(directoryPath) {
        const directory = Gio.File.new_for_path(directoryPath);
        const directoryInfo = directory.query_info(
            'standard::type',
            Gio.FileQueryInfoFlags.NONE,
            null
        );

        if (directoryInfo.get_file_type() !== Gio.FileType.DIRECTORY)
            throw new Error(`Not a directory: ${directoryPath}`);

        const enumerator = directory.enumerate_children(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            null
        );

        const images = [];

        try {
            let info;

            while ((info = enumerator.next_file(null)) !== null) {
                if (info.get_file_type() !== Gio.FileType.REGULAR)
                    continue;

                const name = info.get_name();

                if (!/\.(jpe?g|png|webp)$/i.test(name))
                    continue;

                images.push(directory.get_child(name).get_path());
            }
        } finally {
            enumerator.close(null);
        }

        images.sort((a, b) =>
            GLib.path_get_basename(a).localeCompare(
                GLib.path_get_basename(b),
                undefined,
                { numeric: true, sensitivity: 'base' }
            )
        );

        if (images.length < 2) {
            throw new Error(
                `The selected directory must contain at least two ` +
                `JPG, PNG or WebP images: ${directoryPath}`
            );
        }

        // Keep the special 24-hour timing for the original 16-frame Mojave set.
        const mojaveByNumber = new Map();

        for (const path of images) {
            const name = GLib.path_get_basename(path);
            const match = name.match(/^mojave_dynamic_(\d+)\.jpeg$/i);

            if (match)
                mojaveByNumber.set(Number(match[1]), path);
        }

        const isMojave =
            images.length === 16 &&
            Array.from({ length: 16 }, (_, i) => i + 1)
                .every(number => mojaveByNumber.has(number));

        let schedule;
        let scheduleName;

        if (isMojave) {
            const mojaveTimes = [
                [0, 15],
                [180, 16],
                [300, 1],
                [360, 2],
                [420, 3],
                [480, 4],
                [540, 5],
                [600, 6],
                [660, 7],
                [780, 8],
                [840, 9],
                [900, 10],
                [960, 11],
                [1020, 12],
                [1080, 13],
                [1200, 14],
                [1380, 15],
            ];

            schedule = mojaveTimes.map(([minute, number]) => ({
                minute,
                image: mojaveByNumber.get(number),
            }));

            scheduleName = 'Mojave';
        } else {
            // Generic image sets are distributed evenly over 24 hours.
            schedule = images.map((image, index) => ({
                minute: Math.floor(index * 1440 / images.length),
                image,
            }));

            scheduleName = 'Generic 24-hour schedule';
        }

        return {
            directory: directoryPath,
            images,
            schedule,
            scheduleName,
        };
    }

    _loadImageSet() {
        // Validate the complete set before replacing the active schedule.
        const loaded = this._readImageSet(this._getDirectory());

        this._directory = loaded.directory;
        this._images = loaded.images;
        this._schedule = loaded.schedule;
        this._scheduleName = loaded.scheduleName;

        console.log(
            `[Dynamic Desktop] Loaded ${loaded.images.length} images ` +
            `from ${loaded.directory} (${loaded.scheduleName})`
        );

        if (!this._currentActor) {
            this._showInitialImage(this._imageForNow(new Date()));
        } else {
            this._refreshSchedule();
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

    _createActor(imagePath, initialOpacity = 0) {
        const file = Gio.File.new_for_path(imagePath);

        if (!file.query_exists(null))
            throw new Error(`Wallpaper not found: ${imagePath}`);

        const monitor = Main.layoutManager.primaryMonitor;
        const backgroundGroup =
            Main.layoutManager._backgroundGroup ??
            Main.layoutManager.backgroundGroup;

        if (!monitor || !backgroundGroup)
            throw new Error('GNOME background group is unavailable');

        const actor = new St.Widget({
            name: 'dynamic-desktop-wallpaper-layer',
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

    _showInitialImage(imagePath) {
        const actor = this._createActor(imagePath, 0);

        this._currentActor = actor;
        this._currentImagePath = imagePath;

        console.log(
            `[Dynamic Desktop] Starting with ` +
            GLib.path_get_basename(imagePath)
        );

        actor.ease({
            opacity: 255,
            duration: this._transitionMs,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: () => {
                if (this._active)
                    this._refreshSchedule();
            },
        });
    }

    _refreshSchedule() {
        if (!this._active)
            return;

        const desiredImage = this._imageForNow(new Date());

        if (desiredImage !== this._currentImagePath) {
            this._transitionTo(desiredImage);
            return;
        }

        this._scheduleNextBoundary();
    }

    _destroyActor(actor) {
        if (!actor)
            return;

        actor.remove_all_transitions();
        actor.destroy();
        this._actors.delete(actor);
    }

    _transitionTo(imagePath) {
        if (!this._active)
            return;

        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }

        if (imagePath === this._currentImagePath) {
            this._scheduleNextBoundary();
            return;
        }

        let nextActor;

        try {
            nextActor = this._createActor(imagePath, 0);
        } catch (error) {
            logError(error, '[Dynamic Desktop] Could not create next frame');
            this._scheduleNextBoundary();
            return;
        }

        // A rapid settings change must not leave three or more active layers.
        for (const actor of [...this._actors]) {
            if (actor !== this._currentActor)
                this._destroyActor(actor);
        }

        const previousActor = this._currentActor;
        if (previousActor)
            previousActor.remove_all_transitions();

        const serial = ++this._transitionSerial;

        this._currentActor = nextActor;
        this._currentImagePath = imagePath;

        console.log(
            `[Dynamic Desktop] Transitioning to ` +
            GLib.path_get_basename(imagePath)
        );

        nextActor.ease({
            opacity: 255,
            duration: this._transitionMs,
            mode: Clutter.AnimationMode.EASE_IN_OUT_QUAD,
            onComplete: () => {
                if (!this._active || serial !== this._transitionSerial)
                    return;

                if (previousActor)
                    this._destroyActor(previousActor);

                console.log('[Dynamic Desktop] Crossfade completed');
                this._refreshSchedule();
            },
        });
    }

    _nextBoundary(now) {
        const nowMs = now.getTime();

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

                if (entry.image === this._currentImagePath)
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
        if (!this._settings)
            return;

        if (this._transitionChangedId) {
            this._settings.disconnect(this._transitionChangedId);
            this._transitionChangedId = 0;
        }

        if (this._directoryChangedId) {
            this._settings.disconnect(this._directoryChangedId);
            this._directoryChangedId = 0;
        }

        this._settings = null;
    }

    _removeAllActors() {
        for (const actor of [...(this._actors ?? [])])
            this._destroyActor(actor);

        this._actors?.clear();
        this._currentActor = null;
        this._currentImagePath = null;
    }

    disable() {
        this._active = false;

        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }

        this._transitionSerial++;
        this._disconnectSettings();
        this._removeAllActors();

        console.log(
            '[Dynamic Desktop] Disabled; temporary wallpaper layers removed'
        );
    }
}
