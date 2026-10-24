import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

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

        const wallpaperGroup = new Adw.PreferencesGroup({
            title: 'Набір шпалер',
            description:
                'Оберіть теку з JPG, PNG або WebP-зображеннями. ' +
                'Потрібно щонайменше два кадри.',
        });

        const directoryRow = new Adw.ActionRow({
            title: 'Папка зі шпалерами',
            subtitle:
                settings.get_string('wallpaper-directory') ||
                defaultDirectory,
        });

        const chooseButton = new Gtk.Button({
            label: 'Вибрати…',
            valign: Gtk.Align.CENTER,
        });

        chooseButton.connect('clicked', () => {
            const chooser = Gtk.FileChooserNative.new(
                'Вибрати теку зі шпалерами',
                window,
                Gtk.FileChooserAction.SELECT_FOLDER,
                'Вибрати',
                'Скасувати'
            );

            const currentPath =
                settings.get_string('wallpaper-directory') ||
                defaultDirectory;

            try {
                chooser.set_current_folder(
                    Gio.File.new_for_path(currentPath)
                );
            } catch (error) {
                console.warn(
                    `[Dynamic Desktop] Cannot open current folder: ${error}`
                );
            }

            chooser.connect('response', (dialog, response) => {
                if (response === Gtk.ResponseType.ACCEPT) {
                    const file = dialog.get_file();
                    const path = file?.get_path();

                    if (path) {
                        settings.set_string('wallpaper-directory', path);
                        directoryRow.subtitle = path;
                    }
                }

                dialog.destroy();
            });

            chooser.show();
        });

        const defaultButton = new Gtk.Button({
            label: 'Mojave',
            valign: Gtk.Align.CENTER,
        });

        defaultButton.connect('clicked', () => {
            settings.set_string('wallpaper-directory', '');
            directoryRow.subtitle = defaultDirectory;
        });

        directoryRow.add_suffix(chooseButton);
        directoryRow.add_suffix(defaultButton);
        wallpaperGroup.add(directoryRow);

        const formatRow = new Adw.ActionRow({
            title: 'Режим розкладу',
            subtitle:
                'Mojave: спеціальний розклад. Інші набори: рівномірно протягом доби.',
        });

        wallpaperGroup.add(formatRow);
        page.add(wallpaperGroup);

        const transitionGroup = new Adw.PreferencesGroup({
            title: 'Плавні переходи',
            description: 'Тривалість перехресного проявлення зображень.',
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
        page.add(transitionGroup);

        window.add(page);
    }
}
