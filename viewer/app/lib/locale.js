// locale.js — which language the viewer speaks.
//
// Puzzle's i18n service already resolves the startup locale as
//
//   1. the saved choice (localStorage `__puzzleLocale`, written by setLocale),
//   2. else the browser's languages matched against i18n.locales — exact tag,
//      then base language, then the first configured tag with that base, so
//      `pt` → `pt-BR` (listed before `pt-PT`) and `zh`/`zh-CN` → `zh-Hans`,
//   3. else `en`,
//
// and keeps `<html lang>` in step on every switch. This module adds the list
// the picker shows and the setter it calls. Same shape as Pyramid's
// state/locale.js, so the two apps' pickers agree.

import { language } from './i18n.js';

/**
 * The launch locales, each in its own name — the picker shows these as they
 * are, never translated. Order is the picker's order. Keep in step with
 * `i18n.locales` in puzzle.config.js (tests/viewer/i18n-locales.test.js checks).
 */
export const LANGUAGES = [
	{ value: 'en', label: 'English' }, // i18n-ok: endonym
	{ value: 'es', label: 'Español' }, // i18n-ok: endonym
	{ value: 'de', label: 'Deutsch' }, // i18n-ok: endonym
	{ value: 'fr', label: 'Français' }, // i18n-ok: endonym
	{ value: 'it', label: 'Italiano' }, // i18n-ok: endonym
	{ value: 'pt-BR', label: 'Português (Brasil)' }, // i18n-ok: endonym
	{ value: 'pt-PT', label: 'Português (Portugal)' }, // i18n-ok: endonym
	{ value: 'nl', label: 'Nederlands' }, // i18n-ok: endonym
	{ value: 'ja', label: '日本語' }, // i18n-ok: endonym
	{ value: 'ko', label: '한국어' }, // i18n-ok: endonym
	{ value: 'zh-Hans', label: '简体中文' }, // i18n-ok: endonym
];

/** @type {any} the Puzzle i18n service (app.i18n), bound by app.js */
let service = null;

/** @param {any} svc */
export function bindLocaleService(svc) {
	service = svc;
}

/** The active language tag. */
export function current() {
	return language();
}

/**
 * Switch the viewer's language now, without a reload. Puzzle fetches the
 * table, swaps it in, remembers the choice on this device, sets `<html lang>`
 * and rebuilds the page in place. Rejects when the file fails to load.
 * @param {string} tag one of LANGUAGES
 * @returns {Promise<void>}
 */
export async function setLanguage(tag) {
	if (!service) return;
	if (!LANGUAGES.some((l) => l.value === tag)) return;
	await service.setLocale(tag);
}
