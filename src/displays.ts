import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import {BRIGHTNESS_VCP_CODE, CONTRAST_VCP_CODE, LOG_PREFIX} from './constants.js';
import * as Ddcutil from './ddcutil.js';

export type ControlKind = 'brightness' | 'contrast';

export interface ControlInfo {
    vcpCode: string;
    currentValue: number;
    slider: Slider.Slider | null;
    valueLabel: St.Label | null;
    sentValue: number;
    inFlight: boolean;
    reading: boolean;
    updatingFromCode: boolean;
}

export interface DisplayInfo {
    bus: string;
    name: string;
    connector: string;
    monitorIndex: number;
    brightness: ControlInfo;
    contrast: ControlInfo;
}

function createControl(vcpCode: string): ControlInfo {
    return {vcpCode, currentValue: 50, slider: null, valueLabel: null, sentValue: 50, inFlight: false, reading: false, updatingFromCode: false};
}

export class DisplayController {
    private _settings: Gio.Settings;
    private _displays: DisplayInfo[] = [];
    private _detectComplete = false;
    private _disposed = false;
    onDetectComplete: (() => void) | null = null;

    constructor(settings: Gio.Settings) {
        this._settings = settings;
    }

    get displays(): DisplayInfo[] { return this._displays; }
    get detectComplete(): boolean { return this._detectComplete; }

    reset(): void {
        this._displays = [];
        this._detectComplete = false;
    }

    cleanup(): void { this._disposed = true; }

    detect(): void {
        Ddcutil.detectDisplays(parsed => {
            if (this._disposed) return;
            this._displays = parsed.map(p => ({
                bus: p.bus, name: p.name, connector: p.connector, monitorIndex: -1,
                brightness: createControl(BRIGHTNESS_VCP_CODE),
                contrast: createControl(CONTRAST_VCP_CODE),
            }));
            this._detectComplete = true;
            console.debug(`${LOG_PREFIX} Found ${this._displays.length} displays`);
            this._mapMonitorsToDisplays();
            this.onDetectComplete?.();
            for (const display of this._displays) {
                this.readControl(display, 'brightness');
                this.readControl(display, 'contrast');
            }
        });
    }

    private _mapMonitorsToDisplays(): void {
        const manager = global.backend.get_monitor_manager();
        for (const display of this._displays) {
            if (!display.connector) continue;
            const index = manager.get_monitor_for_connector(display.connector);
            if (index >= 0) display.monitorIndex = index;
        }
    }

    private _control(display: DisplayInfo, kind: ControlKind): ControlInfo { return display[kind]; }

    private _targets(display: DisplayInfo): DisplayInfo[] {
        return this._settings.get_boolean('link-displays') ? this._displays : [display];
    }

    getActiveDisplay(): DisplayInfo | null {
        if (this._settings.get_boolean('link-displays')) return this._displays[0] ?? null;
        const focused = global.display.focus_window?.get_monitor() ?? global.display.get_primary_monitor();
        return this._displays.find(display => display.monitorIndex === focused) ?? this._displays[0] ?? null;
    }

    // Keyboard shortcuts remain brightness-only. Contrast is adjusted from its slider.
    adjustBrightnessDelta(delta: number): void {
        const display = this.getActiveDisplay();
        if (display) this.setControlValue(display, 'brightness', display.brightness.currentValue + delta * this._settings.get_int('step'));
    }

    setFromSlider(display: DisplayInfo, kind: ControlKind, percent: number): void {
        this.setControlValue(display, kind, percent);
    }

    setControlValue(display: DisplayInfo, kind: ControlKind, rawValue: number): void {
        const value = Math.max(0, Math.min(100, rawValue));
        for (const target of this._targets(display)) {
            const control = this._control(target, kind);
            control.currentValue = value;
            this._updateControlUi(control, value);
            this._requestSend(target, control);
        }
    }

    private _updateControlUi(control: ControlInfo, value: number): void {
        control.updatingFromCode = true;
        if (control.slider) control.slider.value = value / 100;
        control.valueLabel?.set_text(`${value}%`);
        control.updatingFromCode = false;
    }

    private _requestSend(display: DisplayInfo, control: ControlInfo): void {
        if (this._disposed || control.inFlight || control.currentValue === control.sentValue) return;
        const value = control.currentValue;
        control.sentValue = value;
        control.inFlight = true;
        Ddcutil.setBrightness(display.bus, control.vcpCode, value, () => {
            control.inFlight = false;
            this._requestSend(display, control);
        });
    }

    private readControl(display: DisplayInfo, kind: ControlKind): void {
        const control = this._control(display, kind);
        if (control.reading) return;
        control.reading = true;
        Ddcutil.readBrightness(display.bus, control.vcpCode, value => {
            control.reading = false;
            if (this._disposed || value === null) return;
            control.sentValue = value;
            control.currentValue = value;
            this._updateControlUi(control, value);
        });
    }
}
