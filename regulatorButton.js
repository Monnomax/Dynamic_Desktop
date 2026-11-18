import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';

export const RegulatorButton = GObject.registerClass(
    class RegulatorButton extends Gtk.Button {
        _init({
            getValue,
            setValue,
            minValue,
            maxValue,
            step,
            defaultValue,
            digits = 2,
            width = 72,
            formatValue = null,
            subscribe = null,
        }) {
            const defaultLabel = formatValue
                ? formatValue(defaultValue)
                : defaultValue.toFixed(digits);

            super._init({
                valign: Gtk.Align.CENTER,
                width_request: width,
                tooltip_text:
                    `Прокрутка — змінити значення, клік — скинути до ${defaultLabel}`,
            });

            this._getValue = getValue;
            this._setValueFn = setValue;
            this._minValue = minValue;
            this._maxValue = maxValue;
            this._step = step;
            this._defaultValue = defaultValue;
            this._digits = digits;
            this._formatValue = formatValue;

            this._value = this._getValue();
            this.add_css_class('numeric');
            this._updateLabel();

            const scrollController = new Gtk.EventControllerScroll({
                flags:
                    Gtk.EventControllerScrollFlags.VERTICAL |
                    Gtk.EventControllerScrollFlags.DISCRETE,
            });
            scrollController.connect('scroll', (_controller, _dx, dy) => {
                this._adjustValue(dy > 0 ? -this._step : this._step);
                return Gdk.EVENT_STOP;
            });
            this.add_controller(scrollController);

            this.connect('clicked', () => this._setValue(this._defaultValue));

            this._unsubscribe = subscribe
                ? subscribe(() => {
                    this._value = this._getValue();
                    this._updateLabel();
                })
                : null;

            this.connect('destroy', () => {
                if (this._unsubscribe) {
                    this._unsubscribe();
                    this._unsubscribe = null;
                }
            });
        }

        static forSetting(settings, key, options) {
            return new RegulatorButton({
                ...options,
                getValue: () => settings.get_double(key),
                setValue: value => settings.set_double(key, value),
                subscribe: callback => {
                    const id = settings.connect(`changed::${key}`, callback);
                    return () => settings.disconnect(id);
                },
            });
        }

        static forValue(options) {
            return new RegulatorButton(options);
        }

        getCurrentValue() {
            return this._value;
        }

        _adjustValue(delta) {
            this._setValue(this._value + delta);
        }

        _setValue(value) {
            value = Math.min(this._maxValue, Math.max(this._minValue, value));
            value = Math.round(value / this._step) * this._step;
            const factor = 10 ** this._digits;
            value = Math.round(value * factor) / factor;

            this._value = value;
            this._setValueFn(value);
            this._updateLabel();
        }

        _updateLabel() {
            this.set_label(
                this._formatValue
                    ? this._formatValue(this._value)
                    : this._value.toFixed(this._digits)
            );
        }
    },
);
