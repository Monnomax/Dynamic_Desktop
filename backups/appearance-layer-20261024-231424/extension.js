import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import { calculateSolarPosition, selectSolarFrame } from './solar.js';

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
        this._previewTimeoutId = 0;
        this._reloadTimeoutId = 0;
        this._transitionSerial = 0;
        this._lastSolarDiagnosticFrame = null;
        this._lastSolarDiagnosticForce = true;

        this._settings = this.getSettings();

        this._desktopAppearanceSettings = new Gio.Settings({
            schema_id: 'org.gnome.desktop.interface',
        });

        this._desktopAppearanceChangedId =
            this._desktopAppearanceSettings.connect(
                'changed::color-scheme',
                () => {
                    if (
                        this._active &&
                        this._settings &&
                        this._settings.get_string('schedule-mode') === 'appearance'
                    ) {
                        this._refreshSchedule();
                    }
                }
            );
        this._transitionMs = Math.round(
            this._settings.get_double('transition-duration') * 1000
        );

        this._transitionChangedId = this._settings.connect(
            'changed::transition-duration',
            () => {
                this._transitionMs = Math.round(
                    this._settings.get_double('transition-duration') * 1000
                );
            }
        );

        this._directoryChangedId = this._settings.connect(
            'changed::wallpaper-directory',
            () => this._queueReload()
        );

        this._scheduleChangedId = this._settings.connect(
            'changed::schedule-json',
            () => this._queueReload()
        );

        this._previewChangedId = this._settings.connect(
            'changed::preview-image',
            () => this._handlePreviewRequest()
        );

        this._modeChangedId = this._settings.connect(
            'changed::schedule-mode',
            () => this._queueReload()
        );

        this._appearanceLightChangedId = this._settings.connect(
            'changed::appearance-light-image',
            () => this._queueReload()
        );

        this._appearanceDarkChangedId = this._settings.connect(
            'changed::appearance-dark-image',
            () => this._queueReload()
        );

        this._latitudeChangedId = this._settings.connect(
            'changed::latitude',
            () => this._queueReload()
        );

        this._longitudeChangedId = this._settings.connect(
            'changed::longitude',
            () => this._queueReload()
        );

        this._solarLocationChangedId = this._settings.connect(
            'changed::solar-location-configured',
            () => this._queueReload()
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

    _handlePreviewRequest() {
        if (!this._active || !this._settings)
            return;

        const imagePath = this._settings.get_string('preview-image').trim();

        if (!imagePath) {
            if (this._previewTimeoutId) {
                GLib.Source.remove(this._previewTimeoutId);
                this._previewTimeoutId = 0;
            }
            return;
        }

        if (!this._images || !this._images.includes(imagePath)) {
            console.warn(
                '[Dynamic Desktop] Preview rejected: image is not in the active set'
            );
            this._settings.set_string('preview-image', '');
            return;
        }

        if (this._previewTimeoutId) {
            GLib.Source.remove(this._previewTimeoutId);
            this._previewTimeoutId = 0;
        }

        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }

        const scheduleReturn = () => {
            if (this._previewTimeoutId) {
                GLib.Source.remove(this._previewTimeoutId);
                this._previewTimeoutId = 0;
            }

            this._previewTimeoutId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                10,
                () => {
                    this._previewTimeoutId = 0;

                    if (!this._active)
                        return GLib.SOURCE_REMOVE;

                    if (
                        this._settings &&
                        this._settings.get_string('preview-image') === imagePath
                    ) {
                        this._settings.set_string('preview-image', '');
                    }

                    console.log(
                        '[Dynamic Desktop] Preview ended; restoring scheduled frame'
                    );

                    this._refreshSchedule();
                    return GLib.SOURCE_REMOVE;
                }
            );
        };

        if (imagePath === this._currentImagePath) {
            console.log(
                '[Dynamic Desktop] Preview requested for current frame'
            );
            scheduleReturn();
            return;
        }

        const previousActor = this._currentActor;

        for (const actor of [...this._actors]) {
            if (actor !== previousActor)
                this._destroyActor(actor);
        }

        let nextActor;

        try {
            nextActor = this._createActor(imagePath, 0);
        } catch (error) {
            logError(error, '[Dynamic Desktop] Cannot show preview');
            this._scheduleNextBoundary();
            return;
        }

        previousActor?.remove_all_transitions();

        const serial = ++this._transitionSerial;
        this._currentActor = nextActor;
        this._currentImagePath = imagePath;

        console.log(
            `[Dynamic Desktop] Previewing ${GLib.path_get_basename(imagePath)}`
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

                scheduleReturn();
            },
        });
    }

    _queueReload() {
        if (!this._active)
            return;

        // Coalesce a burst of GSettings notifications into one reload.
        if (this._reloadTimeoutId) {
            GLib.Source.remove(this._reloadTimeoutId);
            this._reloadTimeoutId = 0;
        }

        this._reloadTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            250,
            () => {
                this._reloadTimeoutId = 0;

                if (this._active)
                    this._reloadSafely();

                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _reloadSafely() {
        if (!this._active)
            return;

        try {
            this._loadImageSet();
        } catch (error) {
            logError(error, '[Dynamic Desktop] Cannot update wallpaper set');
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

    _listImages(directoryPath) {
        const directory = Gio.File.new_for_path(directoryPath);
        const info = directory.query_info(
            'standard::type',
            Gio.FileQueryInfoFlags.NONE,
            null
        );

        if (info.get_file_type() !== Gio.FileType.DIRECTORY)
            throw new Error(`Not a directory: ${directoryPath}`);

        const enumerator = directory.enumerate_children(
            'standard::name,standard::type',
            Gio.FileQueryInfoFlags.NONE,
            null
        );

        const images = [];

        try {
            let item;
            while ((item = enumerator.next_file(null)) !== null) {
                if (item.get_file_type() !== Gio.FileType.REGULAR)
                    continue;

                const name = item.get_name();

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

        if (images.length < 2)
            throw new Error('The folder must contain at least two images');

        return images;
    }

    _createDefaultSchedule(images) {
        const byNumber = new Map();

        for (const image of images) {
            const name = GLib.path_get_basename(image);
            const match = name.match(/^mojave_dynamic_(\d+)\.jpeg$/i);

            if (match)
                byNumber.set(Number(match[1]), image);
        }

        const isMojave =
            images.length === 16 &&
            Array.from({ length: 16 }, (_, i) => i + 1)
                .every(number => byNumber.has(number));

        if (isMojave) {
            // Frame 15 starts at 23:00 and remains active after midnight.
            const times = [
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

            return {
                name: 'Mojave',
                schedule: times.map(([minute, number]) => ({
                    minute,
                    image: byNumber.get(number),
                })),
            };
        }

        return {
            name: 'Generic 24-hour schedule',
            schedule: images.map((image, index) => ({
                minute: Math.floor(index * 1440 / images.length),
                image,
            })),
        };
    }

    _createSolarSchedule(images) {
        if (!this._settings.get_boolean('solar-location-configured')) {
            throw new Error(
                'Solar mode requires saved latitude and longitude coordinates.'
            );
        }

        const byNumber = new Map();

        for (const image of images) {
            const name = GLib.path_get_basename(image);
            const match = name.match(/^mojave_dynamic_(\d+)\.jpeg$/i);

            if (match)
                byNumber.set(Number(match[1]), image);
        }

        if (
            images.length !== 16 ||
            Array.from({ length: 16 }, (_, index) => index + 1)
                .some(number => !byNumber.has(number))
        ) {
            throw new Error(
                'Solar mode currently supports the complete 16-image Mojave set only.'
            );
        }

        // Reverse-engineered sun altitude/azimuth anchors from the
        // original Mojave Dynamic Desktop Solar metadata.
        // Frame numbers here are filenames 1..16, not zero-based indexes.
        const anchors = [
            [1,  -0.3427528388, 270.9334057827],
            [2, -10.2397586447,  81.7758871448],
            [3,  -4.2477344081,  86.3354503048],
            [4,   1.3890866331,  90.8126703749],
            [5,   7.1671689705,  95.3074095888],
            [6,  13.0861941916,  99.9206296327],
            [7,  40.4156394649, 129.1865220819],
            [8,  53.4334726617, 182.2330942550],
            [9,  38.7931282006, 233.5515919581],
            [10, 11.0894231713, 261.8715904658],
            [11,  5.1845753237, 266.4432737071],
            [12, -6.2483093741, 275.4420453670],
            [13,-12.2077073521, 280.0703158940],
            [14,-39.4893395199, 309.4185731875],
            [15,-52.7531813788,   2.1750965539],
            [16,-38.0474338868,  53.5090858125],
        ];

        return {
            name: 'Solar (Mojave)',
            schedule: [],
            solarAnchors: anchors.map(([number, altitude, azimuth]) => ({
                image: byNumber.get(number),
                altitude,
                azimuth,
            })),
        };
    }

    _readCustomSchedule(images) {
        const mode = this._settings.get_string('schedule-mode');
        const raw = this._settings.get_string('schedule-json').trim();

        if (mode === 'solar')
            return this._createSolarSchedule(images);

        if (mode === 'appearance') {
            const configuredLight = this._settings
                .get_string('appearance-light-image').trim();
            const configuredDark = this._settings
                .get_string('appearance-dark-image').trim();

            const light = images.includes(configuredLight)
                ? configuredLight
                : images[0];
            const dark = images.includes(configuredDark)
                ? configuredDark
                : images[images.length - 1];

            return {
                name: 'Appearance',
                schedule: [],
                appearance: { light, dark },
            };
        }

        if (!raw)
            return this._createDefaultSchedule(images);

        const entries = JSON.parse(raw);

        if (!Array.isArray(entries) || entries.length !== images.length)
            throw new Error('Custom schedule must include every image exactly once');

        const imageByName = new Map(
            images.map(path => [GLib.path_get_basename(path), path])
        );

        const usedNames = new Set();
        const usedTimes = new Set();
        const schedule = [];

        for (const entry of entries) {
            if (!entry || typeof entry.file !== 'string')
                throw new Error('Invalid entry in custom schedule');

            if (!imageByName.has(entry.file))
                throw new Error(`Image not found in selected folder: ${entry.file}`);

            if (!Number.isInteger(entry.minute) ||
                entry.minute < 0 || entry.minute >= 1440)
                throw new Error(`Invalid time for ${entry.file}`);

            if (usedNames.has(entry.file))
                throw new Error(`Duplicate image in schedule: ${entry.file}`);

            if (usedTimes.has(entry.minute))
                throw new Error(`Two images have the same start time: ${entry.minute}`);

            usedNames.add(entry.file);
            usedTimes.add(entry.minute);

            schedule.push({
                minute: entry.minute,
                image: imageByName.get(entry.file),
            });
        }

        if (usedNames.size !== images.length)
            throw new Error('Custom schedule does not cover all images');

        schedule.sort((a, b) => a.minute - b.minute);

        return {
            name: 'Custom schedule',
            schedule,
        };
    }

    _loadImageSet() {
        // Validate before replacing the currently working set.
        const directory = this._getDirectory();
        const images = this._listImages(directory);
        const result = this._readCustomSchedule(images);

        this._directory = directory;
        this._images = images;
        this._schedule = result.schedule;
        this._solarAnchors = result.solarAnchors ?? null;
        this._appearanceConfig = result.appearance ?? null;
        this._lastSolarDiagnosticForce = true;

        if (!this._solarAnchors) {
            this._setSettingStringIfChanged('solar-status', 'inactive');
            this._setSettingStringIfChanged('solar-current-frame', '');
            this._setSettingStringIfChanged('solar-next-check', '');
            this._setSettingDoubleIfChanged('solar-altitude', 0);
            this._setSettingDoubleIfChanged('solar-azimuth', 0);
        }

        console.log(
            `[Dynamic Desktop] Loaded ${images.length} images from ` +
            `${directory} (${result.name})`
        );

        if (!this._currentActor) {
            this._showInitialImage(this._imageForNow(new Date()));
        } else {
            this._refreshSchedule();
        }
    }

    _sunPosition(date) {
        return calculateSolarPosition(
            date,
            this._settings.get_double('latitude'),
            this._settings.get_double('longitude')
        );
    }

    _setSettingStringIfChanged(key, value) {
        if (!this._settings)
            return;

        if (this._settings.get_string(key) !== value)
            this._settings.set_string(key, value);
    }

    _setSettingDoubleIfChanged(key, value) {
        if (!this._settings || !Number.isFinite(value))
            return;

        // Report hundredths of a degree to avoid insignificant UI updates.
        const rounded = Math.round(value * 100) / 100;

        if (this._settings.get_double(key) !== rounded)
            this._settings.set_double(key, rounded);
    }

    _publishSolarState(sun, selectedImage) {
        this._setSettingStringIfChanged('solar-status', 'active');
        this._setSettingStringIfChanged('solar-current-frame', selectedImage);
        this._setSettingDoubleIfChanged('solar-altitude', sun.altitude);
        this._setSettingDoubleIfChanged('solar-azimuth', sun.azimuth);
    }

    _solarImageForNow(date) {
        const sun = this._sunPosition(date);

        const decision = selectSolarFrame(
            sun,
            this._solarAnchors,
            this._currentImagePath,
            0.5
        );

        this._publishSolarState(sun, decision.selectedAnchor.image);

        const selectedName = GLib.path_get_basename(
            decision.selectedAnchor.image
        );
        const nearestName = GLib.path_get_basename(
            decision.nearestAnchor.image
        );

        const diagnosticState = [
            selectedName,
            nearestName,
            decision.hysteresisAction,
        ].join('|');

        if (
            this._lastSolarDiagnosticForce ||
            this._lastSolarDiagnosticState !== diagnosticState
        ) {
            const advantage = decision.distanceAdvantage === null
                ? ''
                : `, distance-advantage=` +
                  `${decision.distanceAdvantage.toFixed(2)}°`;

            console.log(
                `[Dynamic Desktop] Solar diagnostic: ` +
                `time=${date.toLocaleString()}, ` +
                `altitude=${sun.altitude.toFixed(2)}°, ` +
                `azimuth=${sun.azimuth.toFixed(2)}°, ` +
                `selected=${selectedName}, ` +
                `nearest=${nearestName}, ` +
                `match=${decision.selectedScore.toFixed(5)}, ` +
                `hysteresis=${decision.hysteresisAction}` +
                advantage
            );

            this._lastSolarDiagnosticState = diagnosticState;
            this._lastSolarDiagnosticForce = false;
        }

        return decision.selectedAnchor.image;
    }

    _imageForNow(date) {
        if (this._appearanceConfig) {
            const isDark =
                this._desktopAppearanceSettings.get_string('color-scheme') ===
                'prefer-dark';

            return isDark
                ? this._appearanceConfig.dark
                : this._appearanceConfig.light;
        }

        if (this._solarAnchors)
            return this._solarImageForNow(date);

        const minute = date.getHours() * 60 + date.getMinutes();

        // The last entry wraps around midnight.
        let image = this._schedule[this._schedule.length - 1].image;

        for (const entry of this._schedule) {
            if (minute < entry.minute)
                break;

            image = entry.image;
        }

        return image;
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
            throw new Error('GNOME background group is unavailable');

        const actor = new St.Widget({
            name: 'dynamic-desktop-wallpaper-layer',
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

        const desired = this._imageForNow(new Date());

        if (desired !== this._currentImagePath) {
            this._transitionTo(desired);
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
            nextActor = this._createActor(imagePath);
        } catch (error) {
            logError(error, '[Dynamic Desktop] Could not create next frame');
            this._scheduleNextBoundary();
            return;
        }

        // Remove any abandoned layers from an interrupted earlier transition.
        for (const actor of [...this._actors]) {
            if (actor !== this._currentActor)
                this._destroyActor(actor);
        }

        const previousActor = this._currentActor;
        previousActor?.remove_all_transitions();

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
                const candidate = new Date(
                    now.getFullYear(),
                    now.getMonth(),
                    now.getDate() + dayOffset,
                    Math.floor(entry.minute / 60),
                    entry.minute % 60,
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

        if (this._solarAnchors) {
            // Solar mode polls once per minute; the image changes only
            // when the closest Mojave solar anchor changes.
            this._setSettingStringIfChanged(
                'solar-next-check',
                new Date(Date.now() + 60000).toISOString()
            );

            this._timeoutId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                60,
                () => {
                    this._timeoutId = 0;

                    if (this._active)
                        this._refreshSchedule();

                    return GLib.SOURCE_REMOVE;
                }
            );

            return;
        }

        // Appearance mode waits for a GNOME color-scheme change,
        // rather than scheduling time-based wallpaper transitions.
        if (this._appearanceConfig)
            return;

        const boundary = this._nextBoundary(new Date());

        if (!boundary)
            return;

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

        for (const id of [
            this._transitionChangedId,
            this._directoryChangedId,
            this._scheduleChangedId,
            this._previewChangedId,
            this._modeChangedId,
            this._appearanceLightChangedId,
            this._appearanceDarkChangedId,
            this._latitudeChangedId,
            this._longitudeChangedId,
            this._solarLocationChangedId,
        ]) {
            if (id)
                this._settings.disconnect(id);
        }

        this._transitionChangedId = 0;
        this._directoryChangedId = 0;
        this._scheduleChangedId = 0;
        this._previewChangedId = 0;
        this._modeChangedId = 0;
        this._appearanceLightChangedId = 0;
        this._appearanceDarkChangedId = 0;
        this._latitudeChangedId = 0;
        this._longitudeChangedId = 0;
        this._solarLocationChangedId = 0;
        this._settings = null;

        if (this._desktopAppearanceSettings &&
            this._desktopAppearanceChangedId) {
            this._desktopAppearanceSettings.disconnect(
                this._desktopAppearanceChangedId
            );
        }

        this._desktopAppearanceChangedId = 0;
        this._desktopAppearanceSettings = null;
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

        if (this._previewTimeoutId) {
            GLib.Source.remove(this._previewTimeoutId);
            this._previewTimeoutId = 0;
        }

        if (this._settings &&
            this._settings.get_string('preview-image')) {
            this._settings.set_string('preview-image', '');
        }

        if (this._reloadTimeoutId) {
            GLib.Source.remove(this._reloadTimeoutId);
            this._reloadTimeoutId = 0;
        }

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
