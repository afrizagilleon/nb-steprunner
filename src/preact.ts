// preact/hooks/htm are BUNDLED, not pulled from CDN globals.
//
// They used to be read off `window` (populated by @require'd UMD builds). That made the
// script depend on load order and silently broke when someone @require'd the engine from
// their own wrapper without also declaring — in the right order — the preact @require
// lines: `window.preact` was undefined at module-eval time and the panel never mounted.
// Bundling costs a few KB and removes the whole failure mode.

import { h as _h, render as _render } from 'preact';
import { useState as _useState, useEffect as _useEffect, useRef as _useRef, useCallback as _useCallback } from 'preact/hooks';
import htm from 'htm';

export const h = _h;
export const render = _render;
export const html = htm.bind(_h);

export const useState = _useState;
export const useEffect = _useEffect;
export const useRef = _useRef;
export const useCallback = _useCallback;
