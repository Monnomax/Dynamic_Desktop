import GLib from "gi://GLib";
import { calculateSolarPosition, selectSolarFrame } from "./solar.js";

export class SolarController {
    constructor(extension) {
        this._extension = extension;
        this._anchors = null;
        this._lastDiagnosticState = null;
        this._lastDiagnosticForce = true;
    }

    setAnchors(anchors) {
        this._anchors = anchors;
        this._lastDiagnosticForce = true;

        if (!anchors) {
            this._setSettingStringIfChanged("solar-status", "inactive");
            this._setSettingStringIfChanged("solar-current-frame", "");
            this._setSettingStringIfChanged("solar-next-check", "");
            this._setSettingDoubleIfChanged("solar-altitude", 0);
            this._setSettingDoubleIfChanged("solar-azimuth", 0);
        }
    }

    _sunPosition(date) {
        const settings = this._extension._settings;

        return calculateSolarPosition(
            date,
            settings.get_double("latitude"),
            settings.get_double("longitude"),
        );
    }

    _setSettingStringIfChanged(key, value) {
        const settings = this._extension._settings;

        if (!settings) return;

        if (settings.get_string(key) !== value) settings.set_string(key, value);
    }

    _setSettingDoubleIfChanged(key, value) {
        const settings = this._extension._settings;

        if (!settings || !Number.isFinite(value)) return;

        const rounded = Math.round(value * 100) / 100;

        if (settings.get_double(key) !== rounded)
            settings.set_double(key, rounded);
    }

    _publishSolarState(sun, selectedImage) {
        this._setSettingStringIfChanged("solar-status", "active");
        this._setSettingStringIfChanged("solar-current-frame", selectedImage);
        this._setSettingDoubleIfChanged("solar-altitude", sun.altitude);
        this._setSettingDoubleIfChanged("solar-azimuth", sun.azimuth);
    }

    setNextCheck(date) {
        this._setSettingStringIfChanged("solar-next-check", date.toISOString());
    }

    _solarImageForNow(date) {
        if (!this._anchors) return null;

        const sun = this._sunPosition(date);
        const decision = selectSolarFrame(
            sun,
            this._anchors,
            this._extension._wallpaperManager.currentImagePath,
            0.5,
        );

        this._publishSolarState(sun, decision.selectedAnchor.image);

        const selectedName = GLib.path_get_basename(
            decision.selectedAnchor.image,
        );
        const nearestName = GLib.path_get_basename(
            decision.nearestAnchor.image,
        );

        const diagnosticState = [
            selectedName,
            nearestName,
            decision.hysteresisAction,
        ].join("|");

        if (
            this._lastDiagnosticForce ||
            this._lastDiagnosticState !== diagnosticState
        ) {
            const advantage =
                decision.distanceAdvantage === null
                    ? ""
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
                    advantage,
            );

            this._lastDiagnosticState = diagnosticState;
            this._lastDiagnosticForce = false;
        }

        return decision.selectedAnchor.image;
    }

    disable() {
        this._anchors = null;
        this._lastDiagnosticState = null;
    }
}
