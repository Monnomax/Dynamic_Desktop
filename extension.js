import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { DynamicDesktopRuntime } from "./src/extensionRuntime.js";

export default class DynamicDesktopExtension extends Extension {
    enable() {
        this._runtime = new DynamicDesktopRuntime(this.getSettings());
        this._runtime.enable();
    }

    disable() {
        this._runtime?.disable();
        this._runtime = null;
    }
}
