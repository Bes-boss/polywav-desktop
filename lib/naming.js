/** Naming rules for the Normalise panel.
 *
 * The panel holds one ordered list of chips, and that order IS the template.
 * Exactly one chip — `name` — is per-channel; every other chip is clip-level.
 * From that single distinction all three outputs derive:
 *
 *   MXF filename    all chips in order   LIAU8_08042026_BOOM1_AMANDA_604.mxf
 *   AAF clip name   the same string      LIAU8_08042026_BOOM1_AMANDA_604
 *   AAF track name  the `name` chip      AMANDA
 *
 * File and clip name match deliberately: an assistant searching the bin and
 * browsing the folder should see one string, not two that nearly agree.
 *
 * Pure functions, no DOM, so the preview the editor sees and the names the
 * engine writes come from the same code and cannot drift.
 */

/** Splits e.g. LIAU8_BOOM1_08042026_163205_604 into show/source/day/take. */
const DEFAULT_CLIP_PATTERN =
  '^(?<show>[A-Za-z0-9]+)_(?<source>[A-Za-z0-9]+)_(?<day>\\d{6,8})_\\d+_(?<take>\\d+)$';

const EMPTY_TOKENS = { show: '', day: '', source: '', take: '' };

/** Characters Windows and Avid will not accept in a filename. */
const UNSAFE_FILENAME_CHARS = /[\\/:*?"<>|]+/g;

/** Collapse repeated separators and trim them from both ends. */
function tidySeparators(value) {
  return String(value)
    .replace(/[_\-.]{2,}/g, (run) => run.charAt(0))
    .replace(/^[_\-.]+/, '')
    .replace(/[_\-.]+$/, '');
}

/**
 * Parse clip-level tokens out of a source filename stem.
 *
 * A filename that does not match returns empty tokens rather than partial
 * guesses: the editor corrects four blank fields far more easily than four
 * plausible-looking wrong ones.
 */
function parseClipTokens(stem, pattern) {
  const tokens = Object.assign({}, EMPTY_TOKENS);
  if (!stem || !pattern) return tokens;
  let match = null;
  try {
    match = new RegExp(pattern).exec(String(stem));
  } catch (e) {
    return tokens;   // a half-typed pattern must not break the panel
  }
  if (!match || !match.groups) return tokens;
  Object.keys(tokens).forEach((key) => {
    tokens[key] = (match.groups[key] || '').trim();
  });
  return tokens;
}

/**
 * Join chip values in chip order.
 *
 * Empty chips contribute nothing at all — not an empty slot between two
 * separators. A channel simply named "AMANDA" matches no prefix and no
 * number, and used to render as "_AMANDA_".
 */
function composeName(chips, values) {
  const parts = (chips || [])
    .map((key) => (values && values[key] != null ? String(values[key]).trim() : ''))
    .filter((part) => part.length > 0);
  return tidySeparators(parts.join('_'));
}

/** Make a track name safe to put in a filename, keeping it readable. */
function fileSafe(value) {
  return tidySeparators(
    String(value == null ? '' : value)
      .replace(UNSAFE_FILENAME_CHARS, ' ')
      .trim()
      .replace(/\s+/g, '_'),
  );
}

/**
 * Derive the filename, clip name and track name for one channel.
 *
 * @param {object} spec
 * @param {string[]} spec.chips       chip keys, in panel order
 * @param {object}   spec.clipTokens  show/day/source/take
 * @param {string}   spec.trackName   this channel's name, as the recorder wrote it
 * @returns {{fileName: string, clipName: string, trackName: string}}
 */
function deriveNames(spec) {
  const chips = (spec && spec.chips) || [];
  const clipTokens = (spec && spec.clipTokens) || {};
  const trackName = (spec && spec.trackName) || '';

  const values = Object.assign({}, clipTokens, { name: fileSafe(trackName) });
  const fileName = composeName(chips, values);

  return {
    fileName: fileName,
    // Identical by design — see the module comment.
    clipName: fileName,
    // Kept exactly as the recordist typed it: Avid displays this, and
    // "BEACH HUT 3" reads better in a track header than "BEACH_HUT_3".
    trackName: String(trackName).trim(),
  };
}

module.exports = {
  DEFAULT_CLIP_PATTERN,
  parseClipTokens,
  composeName,
  deriveNames,
};
