/**
 * Deploy-time wrapper around app.json (the source of truth). The only knob is
 * WEB_BASE_URL: when set (GitHub Pages subdirectory deploys), it is injected
 * into experiments.baseUrl so the web export references assets under
 * /sermaye/ instead of /. Dev server and plain `expo export` keep root paths.
 */
const base = require('./app.json').expo;

const baseUrl = process.env.WEB_BASE_URL || '';

module.exports = {
  ...base,
  ...(baseUrl ? { experiments: { ...base.experiments, baseUrl } } : {}),
};
