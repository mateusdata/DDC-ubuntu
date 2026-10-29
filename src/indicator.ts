import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as Slider from 'resource:///org/gnome/shell/ui/slider.js';
import { ControlKind, DisplayController, DisplayInfo } from './displays.js';

interface IndicatorParams {
    controller: DisplayController;
    settings: Gio.Settings;
    onRefresh: () => void;
    onOpenPrefs: () => void;
}

/**
 * The panel button and its popup menu: a brightness slider per display, a
 * "link displays" toggle, and refresh/settings actions.
 */
export class BrightnessIndicator {
    private _button: PanelMenu.Button;
    private _controller: DisplayController;
    private _settings: Gio.Settings;
    private _onRefresh: () => void;
    private _onOpenPrefs: () => void;
    private _settingsChangedIds: number[] = [];

    constructor(params: IndicatorParams) {
        this._controller = params.controller;
        this._settings = params.settings;
        this._onRefresh = params.onRefresh;
        this._onOpenPrefs = params.onOpenPrefs;

        this._button = new PanelMenu.Button(0.5, 'DDC Brightness');

        const icon = new St.Icon({
            iconName: 'display-brightness-symbolic',
            fallbackIconName: 'display-symbolic',
            styleClass: 'system-status-icon',
        });
        this._button.add_child(icon);

        for (const key of ['show-contrast', 'show-extra-dimming']) {
            this._settingsChangedIds.push(this._settings.connect(`changed::${key}`, () => this.rebuildMenu()));
        }

        this.rebuildMenu();
    }

    get button(): PanelMenu.Button {
        return this._button;
    }

    rebuildMenu(): void {
        const menu = this._button.menu as PopupMenu.PopupMenu;
        menu.removeAll();

        if (!this._controller.detectComplete) {
            const loadingItem = new PopupMenu.PopupMenuItem('Detecting displays...');
            loadingItem.setSensitive(false);
            menu.addMenuItem(loadingItem);
            return;
        }

        const displays = this._controller.displays;
        if (displays.length === 0) {
            const noDisplays = new PopupMenu.PopupMenuItem('No DDC displays found');
            noDisplays.setSensitive(false);
            menu.addMenuItem(noDisplays);
        } else {
            const linkRow = new PopupMenu.PopupSwitchMenuItem(
                'Link displays',
                this._settings.get_boolean('link-displays'),
            );
            linkRow.connect('toggled', (_item: PopupMenu.PopupSwitchMenuItem, state: boolean) => {
                this._settings.set_boolean('link-displays', state);
            });
            menu.addMenuItem(linkRow);

            menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

            for (const display of displays) {
            this._buildSlidersForDisplay(menu, display);
            }
        }

        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        const refreshBtn = new PopupMenu.PopupMenuItem('Refresh Displays');
        refreshBtn.connect('activate', () => {
            this._onRefresh();
        });
        menu.addMenuItem(refreshBtn);

        const prefsBtn = new PopupMenu.PopupMenuItem('Settings');
        prefsBtn.connect('activate', () => {
            this._onOpenPrefs();
        });
        menu.addMenuItem(prefsBtn);
    }

    private _buildSlidersForDisplay(menu: PopupMenu.PopupMenu, display: DisplayInfo): void {
        const labelRow = new PopupMenu.PopupMenuItem(display.name || `Display (bus ${display.bus})`);
        labelRow.setSensitive(false);
        menu.addMenuItem(labelRow);

        this._buildControlSlider(menu, display, 'brightness', 'Brilho');
        if (this._settings.get_boolean('show-contrast')) {
            this._buildControlSlider(menu, display, 'contrast', 'Contraste');
        }
        if (this._settings.get_boolean('show-extra-dimming')) {
            this._buildExtraDimmingSlider(menu, display);
        }
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
    }

    private _buildControlSlider(menu: PopupMenu.PopupMenu, display: DisplayInfo, kind: ControlKind, label: string): void {
        const control = display[kind];

        const sliderRow = new PopupMenu.PopupBaseMenuItem({activate: false});
        sliderRow.add_style_class_name('ddc-brightness-slider');

        const title = new St.Label({
            text: label,
            yAlign: Clutter.ActorAlign.CENTER,
            style: 'min-width: 82px;',
        });
        const slider = new Slider.Slider(control.currentValue / 100);

        const valueLabel = new St.Label({
            text: `${control.currentValue}%`,
            yAlign: Clutter.ActorAlign.CENTER,
            style: 'min-width: 40px; text-align: right;',
        });

        sliderRow.add_child(title);
        sliderRow.add_child(slider);
        sliderRow.add_child(valueLabel);
        menu.addMenuItem(sliderRow);

        control.slider = slider;
        control.valueLabel = valueLabel;

        slider.connect('notify::value', () => {
            if (control.updatingFromCode) return;
            const pct = Math.round(slider.value * 100);
            this._controller.setFromSlider(display, kind, pct);
        });
    }

    private _buildExtraDimmingSlider(menu: PopupMenu.PopupMenu, display: DisplayInfo): void {
        const dimming = display.extraDimming;
        const sliderRow = new PopupMenu.PopupBaseMenuItem({activate: false});
        sliderRow.add_style_class_name('ddc-brightness-slider');

        const title = new St.Label({
            text: 'Escurecimento extra',
            yAlign: Clutter.ActorAlign.CENTER,
            style: 'min-width: 82px;',
        });
        const slider = new Slider.Slider(dimming.currentValue / 100);
        const valueLabel = new St.Label({
            text: `${dimming.currentValue}%`,
            yAlign: Clutter.ActorAlign.CENTER,
            style: 'min-width: 40px; text-align: right;',
        });

        sliderRow.add_child(title);
        sliderRow.add_child(slider);
        sliderRow.add_child(valueLabel);
        menu.addMenuItem(sliderRow);

        dimming.slider = slider;
        dimming.valueLabel = valueLabel;

        slider.connect('notify::value', () => {
            if (dimming.updatingFromCode) return;
            this._controller.setExtraDimming(display, Math.round(slider.value * 100));
        });
    }

    destroy(): void {
        this._settingsChangedIds.forEach(id => this._settings.disconnect(id));
        this._settingsChangedIds = [];
        this._button.destroy();
    }
}
