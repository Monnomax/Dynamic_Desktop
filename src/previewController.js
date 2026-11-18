import GLib from "gi://GLib";

export class PreviewController {
    constructor(extension) {
        this._extension = extension;
        this._timeoutId = 0;
    }

    _handlePreviewRequest() {
        const extension = this._extension;

        if (!extension._active || !extension._settings) return;

        const imagePath = extension._settings
            .get_string("preview-image")
            .trim();

        if (!imagePath) {
            this._cancelTimeout();
            return;
        }

        if (!extension._scheduleController.images.includes(imagePath)) {
            console.warn(
                "[Dynamic Desktop] Preview rejected: image is not in the active set",
            );
            extension._settings.set_string("preview-image", "");
            return;
        }

        this._cancelTimeout();
        extension._scheduleController.cancelScheduledBoundary();

        const scheduleReturn = () => {
            this._cancelTimeout();

            this._timeoutId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                10,
                () => {
                    this._timeoutId = 0;

                    if (!extension._active) return GLib.SOURCE_REMOVE;

                    if (
                        extension._settings &&
                        extension._settings.get_string("preview-image") ===
                            imagePath
                    ) {
                        extension._settings.set_string("preview-image", "");
                    }

                    console.log(
                        "[Dynamic Desktop] Preview ended; restoring scheduled frame",
                    );

                    extension._scheduleController._refreshSchedule();
                    return GLib.SOURCE_REMOVE;
                },
            );
        };

        if (imagePath === extension._wallpaperManager.currentImagePath) {
            console.log(
                "[Dynamic Desktop] Preview requested for current frame",
            );
            scheduleReturn();
            return;
        }

        extension._wallpaperManager.previewTo(imagePath, scheduleReturn);
    }

    _cancelTimeout() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }

    disable() {
        this._cancelTimeout();

        if (
            this._extension._settings &&
            this._extension._settings.get_string("preview-image")
        ) {
            this._extension._settings.set_string("preview-image", "");
        }
    }
}
