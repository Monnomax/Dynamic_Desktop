import GLib from "gi://GLib";

export class PreviewController {
    constructor({ settings, isActive, scheduleController, wallpaperManager }) {
        this._settings = settings;
        this._isActive = isActive;
        this._scheduleController = scheduleController;
        this._wallpaperManager = wallpaperManager;
        this._timeoutId = 0;
    }

    handlePreviewRequest() {
        if (!this._isActive() || !this._settings) return;

        const imagePath = this._settings.get_string("preview-image").trim();

        if (!imagePath) {
            this._cancelTimeout();
            return;
        }

        if (!this._scheduleController.images.includes(imagePath)) {
            console.warn(
                "[Dynamic Desktop] Preview rejected: image is not in the active set",
            );
            this._settings.set_string("preview-image", "");
            return;
        }

        this._cancelTimeout();
        this._scheduleController.cancelScheduledBoundary();

        const scheduleReturn = () => {
            this._cancelTimeout();

            this._timeoutId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                10,
                () => {
                    this._timeoutId = 0;

                    if (!this._isActive()) return GLib.SOURCE_REMOVE;

                    if (
                        this._settings &&
                        this._settings.get_string("preview-image") === imagePath
                    ) {
                        this._settings.set_string("preview-image", "");
                    }

                    console.log(
                        "[Dynamic Desktop] Preview ended; restoring scheduled frame",
                    );

                    this._scheduleController.refresh();
                    return GLib.SOURCE_REMOVE;
                },
            );
        };

        if (imagePath === this._wallpaperManager.currentImagePath) {
            console.log(
                "[Dynamic Desktop] Preview requested for current frame",
            );
            scheduleReturn();
            return;
        }

        this._wallpaperManager.previewTo(imagePath, scheduleReturn);
    }

    _cancelTimeout() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    disable() {
        this._cancelTimeout();

        if (this._settings?.get_string("preview-image"))
            this._settings.set_string("preview-image", "");

        this._settings = null;
        this._scheduleController = null;
        this._wallpaperManager = null;
    }
}
