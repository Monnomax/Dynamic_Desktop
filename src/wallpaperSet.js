import Gio from "gi://Gio";
import GLib from "gi://GLib";

export class WallpaperSet {
    constructor(settings) {
        this._settings = settings;
    }

    _getDirectory() {
        const configured = this._settings
            .get_string("wallpaper-directory")
            .trim();

        if (configured) return configured;

        return GLib.build_filenamev([
            GLib.get_home_dir(),
            "Завантажене",
            "mojave_dynamic",
        ]);
    }

    _listImages(directoryPath) {
        const directory = Gio.File.new_for_path(directoryPath);
        const info = directory.query_info(
            "standard::type",
            Gio.FileQueryInfoFlags.NONE,
            null,
        );

        if (info.get_file_type() !== Gio.FileType.DIRECTORY)
            throw new Error(`Not a directory: ${directoryPath}`);

        const enumerator = directory.enumerate_children(
            "standard::name,standard::type",
            Gio.FileQueryInfoFlags.NONE,
            null,
        );

        const images = [];

        try {
            let item;
            while ((item = enumerator.next_file(null)) !== null) {
                if (item.get_file_type() !== Gio.FileType.REGULAR) continue;

                const name = item.get_name();

                if (!/\.(jpe?g|png|webp)$/i.test(name)) continue;

                images.push(directory.get_child(name).get_path());
            }
        } finally {
            enumerator.close(null);
        }

        images.sort((a, b) =>
            GLib.path_get_basename(a).localeCompare(
                GLib.path_get_basename(b),
                undefined,
                { numeric: true, sensitivity: "base" },
            ),
        );

        if (images.length < 2)
            throw new Error("The folder must contain at least two images");

        return images;
    }

    _createDefaultSchedule(images) {
        const byNumber = new Map();

        for (const image of images) {
            const name = GLib.path_get_basename(image);
            const match = name.match(/^mojave_dynamic_(\d+)\.jpeg$/i);

            if (match) byNumber.set(Number(match[1]), image);
        }

        const isMojave =
            images.length === 16 &&
            Array.from({ length: 16 }, (_, i) => i + 1).every((number) =>
                byNumber.has(number),
            );

        if (isMojave) {
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
                name: "Mojave",
                schedule: times.map(([minute, number]) => ({
                    minute,
                    image: byNumber.get(number),
                })),
            };
        }

        return {
            name: "Generic 24-hour schedule",
            schedule: images.map((image, index) => ({
                minute: Math.floor((index * 1440) / images.length),
                image,
            })),
        };
    }

    _createSolarSchedule(images) {
        const settings = this._settings;

        if (!settings.get_boolean("solar-location-configured")) {
            throw new Error(
                "Solar mode requires saved latitude and longitude coordinates.",
            );
        }

        const byNumber = new Map();

        for (const image of images) {
            const name = GLib.path_get_basename(image);
            const match = name.match(/^mojave_dynamic_(\d+)\.jpeg$/i);

            if (match) byNumber.set(Number(match[1]), image);
        }

        if (
            images.length !== 16 ||
            Array.from({ length: 16 }, (_, index) => index + 1).some(
                (number) => !byNumber.has(number),
            )
        ) {
            throw new Error(
                "Solar mode currently supports the complete 16-image Mojave set only.",
            );
        }

        const anchors = [
            [1, -0.3427528388, 270.9334057827],
            [2, -10.2397586447, 81.7758871448],
            [3, -4.2477344081, 86.3354503048],
            [4, 1.3890866331, 90.8126703749],
            [5, 7.1671689705, 95.3074095888],
            [6, 13.0861941916, 99.9206296327],
            [7, 40.4156394649, 129.1865220819],
            [8, 53.4334726617, 182.233094255],
            [9, 38.7931282006, 233.5515919581],
            [10, 11.0894231713, 261.8715904658],
            [11, 5.1845753237, 266.4432737071],
            [12, -6.2483093741, 275.442045367],
            [13, -12.2077073521, 280.070315894],
            [14, -39.4893395199, 309.4185731875],
            [15, -52.7531813788, 2.1750965539],
            [16, -38.0474338868, 53.5090858125],
        ];

        return {
            name: "Solar (Mojave)",
            schedule: [],
            solarAnchors: anchors.map(([number, altitude, azimuth]) => ({
                image: byNumber.get(number),
                altitude,
                azimuth,
            })),
        };
    }

    _readCustomSchedule(images) {
        const settings = this._settings;
        const mode = settings.get_string("schedule-mode");
        const raw = settings.get_string("schedule-json").trim();

        if (mode === "solar") return this._createSolarSchedule(images);

        if (mode === "appearance") {
            const configuredLight = settings
                .get_string("appearance-light-image")
                .trim();
            const configuredDark = settings
                .get_string("appearance-dark-image")
                .trim();

            const light = images.includes(configuredLight)
                ? configuredLight
                : images[0];
            const dark = images.includes(configuredDark)
                ? configuredDark
                : images[images.length - 1];

            return {
                name: "Appearance",
                schedule: [],
                appearance: { light, dark },
            };
        }

        if (!raw) return this._createDefaultSchedule(images);

        const entries = JSON.parse(raw);

        if (!Array.isArray(entries) || entries.length !== images.length)
            throw new Error(
                "Custom schedule must include every image exactly once",
            );

        const imageByName = new Map(
            images.map((path) => [GLib.path_get_basename(path), path]),
        );

        const usedNames = new Set();
        const usedTimes = new Set();
        const schedule = [];

        for (const entry of entries) {
            if (!entry || typeof entry.file !== "string")
                throw new Error("Invalid entry in custom schedule");

            if (!imageByName.has(entry.file))
                throw new Error(
                    `Image not found in selected folder: ${entry.file}`,
                );

            if (
                !Number.isInteger(entry.minute) ||
                entry.minute < 0 ||
                entry.minute >= 1440
            )
                throw new Error(`Invalid time for ${entry.file}`);

            if (usedNames.has(entry.file))
                throw new Error(`Duplicate image in schedule: ${entry.file}`);

            if (usedTimes.has(entry.minute))
                throw new Error(
                    `Two images have the same start time: ${entry.minute}`,
                );

            usedNames.add(entry.file);
            usedTimes.add(entry.minute);

            schedule.push({
                minute: entry.minute,
                image: imageByName.get(entry.file),
            });
        }

        if (usedNames.size !== images.length)
            throw new Error("Custom schedule does not cover all images");

        schedule.sort((a, b) => a.minute - b.minute);

        return {
            name: "Custom schedule",
            schedule,
        };
    }

    load() {
        const directory = this._getDirectory();
        const images = this._listImages(directory);
        const result = this._readCustomSchedule(images);

        return { directory, images, ...result };
    }
}
