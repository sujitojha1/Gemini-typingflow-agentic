// shared_config.js — Single source of truth for model definitions.
// Loaded by: background.js (via importScripts) and options.html (via <script> tag).

const DEFAULT_GOOGLE_MODELS = [
    { id: 'gemini-3.1-flash-lite', label: 'Gemini Flash Lite 3.1', vision: false },
    { id: 'gemini-3-flash-preview',        label: 'Gemini 3 Flash',        vision: false },
    { id: 'gemini-2.5-flash-lite',         label: 'Gemini 2.5 Flash Lite', vision: false },
    { id: 'gemma-4-26b-a4b-it',           label: 'Gemma 4 26B',           vision: true  },
    { id: 'gemma-4-31b-it',               label: 'Gemma 4 31B',           vision: true  },
];
