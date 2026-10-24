import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function basename(path) {
    return path.substring(path.lastIndexOf('/') + 1);
}

function listImages(directoryPath) {
    const directory = Gio.File.new_for_path(directoryPath);
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

            if (/\.(jpe?g|png|webp)$/i.test(name))
                images.push(directory.get_child(name).get_path());
        }
    } finally {
        enumerator.close(null);
    }

    images.sort((a, b) =>
        basename(a).localeCompare(
            basename(b),
            undefined,
            { numeric: true, sensitivity: 'base' }
        )
    );

    return images;
}

function defaultSchedule(images) {
    const byNumber = new Map();

    for (const path of images) {
        const match = basename(path).match(/^mojave_dynamic_(\d+)\.jpeg$/i);

        if (match)
            byNumber.set(Number(match[1]), path);
    }

    const isMojave =
        images.length === 16 &&
        Array.from({ length: 16 }, (_, i) => i + 1)
            .every(number => byNumber.has(number));

    if (isMojave) {
        const times = new Map([
            [16, 180],
            [1, 300],
            [2, 360],
            [3, 420],
            [4, 480],
            [5, 540],
            [6, 600],
            [7, 660],
            [8, 780],
            [9, 840],
            [10, 900],
            [11, 960],
            [12, 1020],
            [13, 1080],
            [14, 1200],
            [15, 1380],
        ]);

        return images.map(path => {
            const match = basename(path).match(/^mojave_dynamic_(\d+)\.jpeg$/i);

            return {
                file: basename(path),
                minute: times.get(Number(match[1])),
            };
        });
    }

    return images.map((path, index) => ({
        file: basename(path),
        minute: Math.floor(index * 1440 / images.length),
    }));
}

function readSchedule(images, raw) {
    if (!raw.trim())
        return defaultSchedule(images);

    const data = JSON.parse(raw);

    if (!Array.isArray(data) || data.length !== images.length)
        throw new Error('Розклад має містити всі зображення.');

    const names = new Set(images.map(basename));
    const usedNames = new Set();
    const usedTimes = new Set();

    for (const entry of data) {
        if (!entry || !names.has(entry.file))
            throw new Error('Розклад містить невідоме зображення.');

        if (!Number.isInteger(entry.minute) ||
            entry.minute < 0 || entry.minute >= 1440)
            throw new Error('Недійсний час у розкладі.');

        if (usedNames.has(entry.file))
            throw new Error('Зображення повторюється в розкладі.');

        if (usedTimes.has(entry.minute))
            throw new Error('Два зображення не можуть починатися одночасно.');

        usedNames.add(entry.file);
        usedTimes.add(entry.minute);
    }

    return data;
}

export default class DynamicDesktopPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const defaultDirectory = GLib.build_filenamev([
            GLib.get_home_dir(),
            'Завантажене',
            'mojave_dynamic',
        ]);

        const page = new Adw.PreferencesPage({
            title: 'Основні',
        });

        const folderGroup = new Adw.PreferencesGroup({
            title: 'Набір шпалер',
            description: 'Оберіть теку з JPG, PNG або WebP-зображеннями.',
        });

        const folderRow = new Adw.ActionRow({
            title: 'Папка зі шпалерами',
            subtitle: settings.get_string('wallpaper-directory') ||
                defaultDirectory,
        });

        const chooseButton = new Gtk.Button({
            label: 'Вибрати…',
            valign: Gtk.Align.CENTER,
        });

        const restoreFolderButton = new Gtk.Button({
            label: 'Mojave',
            valign: Gtk.Align.CENTER,
        });

        folderRow.add_suffix(chooseButton);
        folderRow.add_suffix(restoreFolderButton);
        folderGroup.add(folderRow);

        page.add(folderGroup);

        const scheduleGroup = new Adw.PreferencesGroup({
            title: 'Часові точки',
            description:
                'Укажіть місцевий час, з якого починається показ кожного кадру.',
        });

        const scheduleRows = [];

        const statusRow = new Adw.ActionRow({
            title: 'Стан розкладу',
            subtitle: 'Завантаження…',
        });

        const actionsGroup = new Adw.PreferencesGroup({
            title: 'Керування розкладом',
        });

        const saveRow = new Adw.ActionRow({
            title: 'Зберегти часові точки',
            subtitle: 'Застосувати власний розклад.',
        });

        const saveButton = new Gtk.Button({
            label: 'Зберегти',
            valign: Gtk.Align.CENTER,
        });

        saveRow.add_suffix(saveButton);
        actionsGroup.add(saveRow);

        const resetRow = new Adw.ActionRow({
            title: 'Типовий розклад',
            subtitle:
                'Mojave використовує власні часові точки; інші набори розподіляються рівномірно.',
        });

        const resetButton = new Gtk.Button({
            label: 'Скинути',
            valign: Gtk.Align.CENTER,
        });

        resetRow.add_suffix(resetButton);
        actionsGroup.add(resetRow);
        actionsGroup.add(statusRow);

        const transitionGroup = new Adw.PreferencesGroup({
            title: 'Плавні переходи',
            description: 'Тривалість перехресного проявлення.',
        });

        const adjustment = new Gtk.Adjustment({
            lower: 1.0,
            upper: 10.0,
            step_increment: 0.5,
            page_increment: 1.0,
            value: settings.get_double('transition-duration'),
        });

        const durationRow = new Adw.SpinRow({
            title: 'Тривалість переходу',
            subtitle: 'У секундах',
            adjustment,
            digits: 1,
        });

        settings.bind(
            'transition-duration',
            durationRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );

        transitionGroup.add(durationRow);

        const controls = [];

        function clearScheduleRows() {
            for (const row of scheduleRows)
                scheduleGroup.remove(row);

            scheduleRows.length = 0;
            controls.length = 0;
        }

        function refreshScheduleEditor() {
            clearScheduleRows();

            const directoryPath =
                settings.get_string('wallpaper-directory') ||
                defaultDirectory;

            folderRow.subtitle = directoryPath;

            let images;

            try {
                images = listImages(directoryPath);
            } catch (error) {
                statusRow.subtitle = `Не вдалося прочитати теку: ${error.message}`;
                saveButton.sensitive = false;
                page.add(scheduleGroup);
                return;
            }

            if (images.length < 2) {
                statusRow.subtitle =
                    'У вибраній теці має бути щонайменше два зображення.';
                saveButton.sensitive = false;
                page.add(scheduleGroup);
                return;
            }

            let entries;
            let usingDefault = false;

            try {
                entries = readSchedule(
                    images,
                    settings.get_string('schedule-json')
                );
            } catch (error) {
                entries = defaultSchedule(images);
                usingDefault = true;
                statusRow.subtitle =
                    `Показано типовий розклад: ${error.message}`;
            }

            const byName = new Map(
                entries.map(entry => [entry.file, entry.minute])
            );

            for (const imagePath of images) {
                const filename = basename(imagePath);
                const minute = byName.get(filename) ?? 0;

                const row = new Adw.ActionRow({
                    title: filename,
                    subtitle: 'Час початку показу',
                });

                const hour = Gtk.SpinButton.new(
                    new Gtk.Adjustment({
                        lower: 0,
                        upper: 23,
                        step_increment: 1,
                        page_increment: 1,
                        value: Math.floor(minute / 60),
                    }),
                    1,
                    0
                );

                const minutes = Gtk.SpinButton.new(
                    new Gtk.Adjustment({
                        lower: 0,
                        upper: 59,
                        step_increment: 1,
                        page_increment: 5,
                        value: minute % 60,
                    }),
                    1,
                    0
                );

                hour.set_width_chars(2);
                minutes.set_width_chars(2);

                const timeBox = new Gtk.Box({
                    orientation: Gtk.Orientation.HORIZONTAL,
                    spacing: 4,
                    valign: Gtk.Align.CENTER,
                });

                timeBox.append(hour);
                timeBox.append(new Gtk.Label({ label: ':' }));
                timeBox.append(minutes);

                row.add_suffix(timeBox);
                scheduleGroup.add(row);
                scheduleRows.push(row);

                controls.push({
                    file: filename,
                    hour,
                    minutes,
                });
            }

            saveButton.sensitive = true;

            if (!usingDefault) {
                statusRow.subtitle = settings.get_string('schedule-json').trim()
                    ? 'Використовується власний розклад.'
                    : 'Використовується типовий розклад.';
            }

            if (!page.get_parent())
                page.add(scheduleGroup);
        }

        chooseButton.connect('clicked', () => {
            const chooser = Gtk.FileChooserNative.new(
                'Вибрати теку зі шпалерами',
                window,
                Gtk.FileChooserAction.SELECT_FOLDER,
                'Вибрати',
                'Скасувати'
            );

            try {
                chooser.set_current_folder(
                    Gio.File.new_for_path(
                        settings.get_string('wallpaper-directory') ||
                        defaultDirectory
                    )
                );
            } catch (_) {
                // The selected directory may no longer exist.
            }

            chooser.connect('response', (dialog, response) => {
                if (response === Gtk.ResponseType.ACCEPT) {
                    const path = dialog.get_file()?.get_path();

                    if (path) {
                        // A custom schedule belongs to its original image set.
                        settings.set_string('schedule-json', '');
                        settings.set_string('wallpaper-directory', path);
                        refreshScheduleEditor();
                    }
                }

                dialog.destroy();
            });

            chooser.show();
        });

        restoreFolderButton.connect('clicked', () => {
            settings.set_string('schedule-json', '');
            settings.set_string('wallpaper-directory', '');
            refreshScheduleEditor();
        });

        saveButton.connect('clicked', () => {
            const entries = controls.map(control => ({
                file: control.file,
                minute:
                    control.hour.get_value_as_int() * 60 +
                    control.minutes.get_value_as_int(),
            }));

            const times = entries.map(entry => entry.minute);

            if (new Set(times).size !== times.length) {
                statusRow.subtitle =
                    'Помилка: кожне зображення повинно мати унікальний час.';
                return;
            }

            entries.sort((a, b) => a.minute - b.minute);

            settings.set_string(
                'schedule-json',
                JSON.stringify(entries)
            );

            statusRow.subtitle =
                `Розклад збережено: ${entries.length} часових точок.`;
        });

        resetButton.connect('clicked', () => {
            settings.set_string('schedule-json', '');
            refreshScheduleEditor();
            statusRow.subtitle = 'Відновлено типовий розклад.';
        });

        page.add(scheduleGroup);
        page.add(actionsGroup);
        page.add(transitionGroup);

        window.add(page);

        refreshScheduleEditor();
    }
}
