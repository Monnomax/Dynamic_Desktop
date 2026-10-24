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

function isMojaveSet(directoryPath) {
    try {
        const names = new Set(listImages(directoryPath).map(basename));

        return names.size === 16 &&
            Array.from({ length: 16 }, (_, index) => index + 1)
                .every(number => names.has(`mojave_dynamic_${number}.jpeg`));
    } catch (_) {
        return false;
    }
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

        const previewGroup = new Adw.PreferencesGroup({
            title: 'Попередній перегляд набору',
            description:
                'Усі зображення вибраної теки. ' +
                'Мініатюри оновлюються після зміни набору.',
        });

        const previewStatus = new Gtk.Label({
            label: 'Очікування списку зображень…',
            xalign: 0,
            wrap: true,
        });

        const previewGrid = new Gtk.Grid({
            column_spacing: 12,
            row_spacing: 12,
            margin_top: 8,
            margin_bottom: 8,
            margin_start: 4,
            margin_end: 4,
        });

        previewGroup.add(previewStatus);
        previewGroup.add(previewGrid);
        page.add(previewGroup);

        const modeGroup = new Adw.PreferencesGroup({
            title: 'Режим зміни шпалер',
            description:
                'Вибери годинниковий розклад, власні часові точки або Solar для Mojave.',
        });

        const modeValues = ['clock', 'custom', 'solar'];
        const modeLabels = [
            'За часом доби',
            'Власний розклад',
            'Solar — положення Сонця',
        ];

        const modeModel = new Gtk.StringList();
        for (const label of modeLabels)
            modeModel.append(label);

        const storedMode = settings.get_string('schedule-mode') || 'clock';

        const modeRow = new Adw.ComboRow({
            title: 'Режим',
            model: modeModel,
            selected: Math.max(0, modeValues.indexOf(storedMode)),
        });

        const modeStatusRow = new Adw.ActionRow({
            title: 'Поточний режим',
            subtitle: '',
        });

        modeGroup.add(modeRow);
        modeGroup.add(modeStatusRow);
        page.add(modeGroup);

        const solarGroup = new Adw.PreferencesGroup({
            title: 'Місце для Solar',
            description:
                'Координати вводяться вручну та зберігаються локально. ' +
                'Solar поки підтримує повний набір Mojave із 16 кадрів.',
        });

        const latitudeRow = new Adw.SpinRow({
            title: 'Широта',
            subtitle: 'Від −90 до 90 градусів',
            adjustment: new Gtk.Adjustment({
                lower: -90,
                upper: 90,
                step_increment: 0.01,
                page_increment: 1,
                value: settings.get_double('latitude'),
            }),
            digits: 4,
        });

        const longitudeRow = new Adw.SpinRow({
            title: 'Довгота',
            subtitle: 'Від −180 до 180 градусів',
            adjustment: new Gtk.Adjustment({
                lower: -180,
                upper: 180,
                step_increment: 0.01,
                page_increment: 1,
                value: settings.get_double('longitude'),
            }),
            digits: 4,
        });

        solarGroup.add(latitudeRow);
        solarGroup.add(longitudeRow);

        const saveLocationRow = new Adw.ActionRow({
            title: 'Зберегти координати',
            subtitle: 'Без онлайн-геолокації.',
        });

        const saveLocationButton = new Gtk.Button({
            label: 'Зберегти',
            valign: Gtk.Align.CENTER,
        });

        saveLocationRow.add_suffix(saveLocationButton);
        solarGroup.add(saveLocationRow);

        function updateModeStatus(mode = settings.get_string('schedule-mode')) {
            if (mode === 'solar') {
                modeStatusRow.subtitle =
                    'Solar: вибір кадру за висотою та азимутом Сонця.';
            } else if (mode === 'custom') {
                modeStatusRow.subtitle =
                    'Власний розклад: часові точки з редактора нижче.';
            } else {
                modeStatusRow.subtitle =
                    'За часом доби: типовий розклад набору.';
            }
        }

        modeRow.connect('notify::selected', () => {
            const requestedMode = modeValues[modeRow.selected] ?? 'clock';

            if (requestedMode === 'solar') {
                const directoryPath =
                    settings.get_string('wallpaper-directory') ||
                    defaultDirectory;

                if (!settings.get_boolean('solar-location-configured')) {
                    modeStatusRow.subtitle =
                        'Спочатку введи та збережи координати.';
                    modeRow.selected = Math.max(
                        0,
                        modeValues.indexOf(
                            settings.get_string('schedule-mode') || 'clock'
                        )
                    );
                    return;
                }

                if (!isMojaveSet(directoryPath)) {
                    modeStatusRow.subtitle =
                        'Solar наразі доступний лише для набору Mojave з 16 кадрів.';
                    modeRow.selected = Math.max(
                        0,
                        modeValues.indexOf(
                            settings.get_string('schedule-mode') || 'clock'
                        )
                    );
                    return;
                }
            }

            settings.set_string('schedule-mode', requestedMode);

            if (requestedMode === 'clock')
                settings.set_string('schedule-json', '');

            updateModeStatus(requestedMode);
        });

        saveLocationButton.connect('clicked', () => {
            // Avoid running a half-updated coordinate pair in Solar mode.
            settings.set_boolean('solar-location-configured', false);
            settings.set_double('latitude', latitudeRow.value);
            settings.set_double('longitude', longitudeRow.value);
            settings.set_boolean('solar-location-configured', true);

            modeStatusRow.subtitle =
                `Координати збережено: ${latitudeRow.value.toFixed(4)}, ` +
                `${longitudeRow.value.toFixed(4)}.`;
        });

        updateModeStatus();
        page.add(solarGroup);

        // Live Solar status and wallpaper preview.
        const solarStatusGroup = new Adw.PreferencesGroup({
            title: 'Стан Solar',
            description:
                'Поточний кадр і розраховане положення Сонця. ' +
                'Дані оновлюються автоматично.',
        });

        const previewPicture = new Gtk.Picture();
        previewPicture.set_size_request(240, 135);
        previewPicture.set_can_shrink(true);
        previewPicture.set_content_fit(Gtk.ContentFit.COVER);
        previewPicture.set_halign(Gtk.Align.CENTER);
        previewPicture.set_valign(Gtk.Align.CENTER);
        previewPicture.set_alternative_text('Поточні шпалери Mojave');

        const previewRow = new Adw.ActionRow({
            title: 'Поточний кадр',
            subtitle: 'Очікування даних Solar…',
        });
        previewRow.add_prefix(previewPicture);
        solarStatusGroup.add(previewRow);

        const solarStateRow = new Adw.ActionRow({
            title: 'Стан',
            subtitle: 'Очікування…',
        });
        solarStatusGroup.add(solarStateRow);

        const altitudeStatusRow = new Adw.ActionRow({
            title: 'Висота Сонця',
            subtitle: '—',
        });
        solarStatusGroup.add(altitudeStatusRow);

        const azimuthStatusRow = new Adw.ActionRow({
            title: 'Азимут Сонця',
            subtitle: '—',
        });
        solarStatusGroup.add(azimuthStatusRow);

        const nextCheckRow = new Adw.ActionRow({
            title: 'Наступна перевірка',
            subtitle: '—',
        });
        solarStatusGroup.add(nextCheckRow);

        function refreshSolarReadout() {
            const mode = settings.get_string('schedule-mode') || 'clock';

            if (mode !== 'solar') {
                solarStateRow.subtitle =
                    'Solar неактивний: вибрано інший режим.';
                previewRow.subtitle = 'Доступний у режимі Solar.';
                previewPicture.set_file(null);
                altitudeStatusRow.subtitle = '—';
                azimuthStatusRow.subtitle = '—';
                nextCheckRow.subtitle = '—';
                return;
            }

            if (!settings.get_boolean('solar-location-configured')) {
                solarStateRow.subtitle =
                    'Спочатку збережи широту й довготу.';
            } else {
                const status = settings.get_string('solar-status');

                solarStateRow.subtitle = status === 'active'
                    ? 'Активний'
                    : 'Очікування даних від розширення…';
            }

            const framePath = settings.get_string('solar-current-frame');

            if (framePath && GLib.file_test(framePath, GLib.FileTest.EXISTS)) {
                previewPicture.set_file(Gio.File.new_for_path(framePath));
                previewRow.subtitle = basename(framePath);
            } else {
                previewPicture.set_file(null);
                previewRow.subtitle = 'Кадр ще не визначено.';
            }

            const altitude = settings.get_double('solar-altitude');
            const azimuth = settings.get_double('solar-azimuth');

            altitudeStatusRow.subtitle =
                `${altitude >= 0 ? '+' : ''}${altitude.toFixed(2)}°`;

            azimuthStatusRow.subtitle = `${azimuth.toFixed(2)}°`;

            const nextValue = settings.get_string('solar-next-check');

            if (nextValue) {
                const nextDate = new Date(nextValue);

                nextCheckRow.subtitle = Number.isNaN(nextDate.getTime())
                    ? 'Очікування наступної перевірки…'
                    : nextDate.toLocaleTimeString(undefined, {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                    });
            } else {
                nextCheckRow.subtitle = '—';
            }
        }

        const solarReadoutSignals = [
            'schedule-mode',
            'solar-location-configured',
            'solar-status',
            'solar-current-frame',
            'solar-altitude',
            'solar-azimuth',
            'solar-next-check',
        ].map(key =>
            settings.connect(`changed::${key}`, refreshSolarReadout)
        );

        window.connect('close-request', () => {
            for (const signalId of solarReadoutSignals) {
                try {
                    settings.disconnect(signalId);
                } catch (_) {
                    // The signal may already have been disconnected.
                }
            }

            return false;
        });

        refreshSolarReadout();
        page.add(solarStatusGroup);

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

        function clearPreviewGrid() {
            let child = previewGrid.get_first_child();

            while (child) {
                const next = child.get_next_sibling();
                previewGrid.remove(child);
                child = next;
            }
        }

        function refreshPreviewGallery(images, errorMessage = '') {
            clearPreviewGrid();

            if (errorMessage) {
                previewStatus.set_text(errorMessage);
                previewGrid.set_visible(false);
                return;
            }

            previewGrid.set_visible(true);
            previewStatus.set_text(
                `Зображень у наборі: ${images.length}`
            );

            images.forEach((imagePath, index) => {
                const filename = basename(imagePath);

                const tile = new Gtk.Box({
                    orientation: Gtk.Orientation.VERTICAL,
                    spacing: 6,
                    halign: Gtk.Align.FILL,
                });
                tile.add_css_class('card');

                const picture = new Gtk.Picture();
                picture.set_size_request(116, 65);
                picture.set_can_shrink(true);
                picture.set_content_fit(Gtk.ContentFit.COVER);
                picture.set_alternative_text(filename);
                picture.set_file(
                    Gio.File.new_for_path(imagePath)
                );

                const label = new Gtk.Label({
                    label: filename,
                    wrap: true,
                    max_width_chars: 18,
                });
                label.set_justify(Gtk.Justification.CENTER);

                tile.append(picture);
                tile.append(label);

                previewGrid.attach(
                    tile,
                    index % 4,
                    Math.floor(index / 4),
                    1,
                    1
                );
            });
        }

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
                refreshPreviewGallery(images);
            } catch (error) {
                refreshPreviewGallery(
                    [],
                    `Не вдалося прочитати теку: ${error.message}`
                );
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
                        settings.set_string('schedule-mode', 'clock');
                        modeRow.selected = 0;
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
            settings.set_string('schedule-mode', 'clock');
            modeRow.selected = 0;
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
            settings.set_string('schedule-mode', 'custom');
            modeRow.selected = 1;
            updateModeStatus('custom');

            statusRow.subtitle =
                `Розклад збережено: ${entries.length} часових точок.`;
        });

        resetButton.connect('clicked', () => {
            settings.set_string('schedule-json', '');
            settings.set_string('schedule-mode', 'clock');
            modeRow.selected = 0;
            updateModeStatus('clock');
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
