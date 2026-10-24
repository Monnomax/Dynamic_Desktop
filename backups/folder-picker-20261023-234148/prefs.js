import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import { ExtensionPreferences } from
    'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class DynamicDesktopPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'Основні',
        });

        const group = new Adw.PreferencesGroup({
            title: 'Плавні переходи',
            description:
                'Налаштування анімації зміни шпалер Mojave.',
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
            subtitle:
                'Час плавного проявлення нового зображення, у секундах.',
            adjustment,
            digits: 1,
        });

        settings.bind(
            'transition-duration',
            durationRow,
            'value',
            Gio.SettingsBindFlags.DEFAULT
        );

        group.add(durationRow);
        page.add(group);
        window.add(page);
    }
}
