// Normalize logic — mirrors app.js parseName/applyTemplate semantics.

export interface Caps {
  prefix: string;
  type: string;
  role: string;
  num: string;
  suffix: string;
  raw: string;
}

const TYPE_MAP: Record<string, string> = {
  MIX: 'Mix', LAV: 'Lav', BOOM: 'Boom', MUS: 'Music', ISO: 'ISO', TC: 'Timecode', SLATE: 'Slate', HST: 'Host',
};

export function parseName(raw: string, pattern?: string): Caps {
  const caps: Caps = { prefix: '', type: '', role: '', num: '', suffix: '', raw };
  if (!raw) return caps;
  let re: RegExp | null = null;
  if (pattern) {
    try { re = new RegExp(pattern); } catch { re = null; }
  }
  const m = re ? re.exec(raw) : null;
  if (m && m.groups) {
    const g = m.groups;
    caps.prefix = g.prefix ?? '';
    caps.role = g.role ?? '';
    caps.num = g.num ?? '';
    caps.suffix = g.suffix ?? '';
  }
  caps.type = TYPE_MAP[caps.prefix.toUpperCase()] ?? (caps.prefix ? caps.prefix : 'Unknown');
  if (!caps.prefix && !caps.role) {
    // Fallback: uppercase raw, strip non-alnum, no numbering knowledge.
    const clean = raw.replace(/[^A-Za-z0-9]+/g, '_').toUpperCase();
    caps.prefix = clean.split('_')[0] ?? '';
    caps.role = clean.split('_').slice(1).join('_');
    caps.type = TYPE_MAP[caps.prefix] ?? 'Unknown';
  }
  return caps;
}

export function padNum(num: string, format: string): string {
  const m = /^0(\d+)d$/.exec(format);
  if (m && num) {
    return String(num).padStart(parseInt(m[1], 10), '0');
  }
  return num;
}

export function applyTemplate(caps: Caps, template: string): string {
  let out = template || '{prefix}_{role}_{num}';
  const fmtMatch = /\{num:(\d+)d\}/.exec(out);
  if (fmtMatch) {
    out = out.replace(`{num:${fmtMatch[1]}d}`, `{num}`);
    return out
      .replace(/\{prefix\}/g, caps.prefix)
      .replace(/\{role\}/g, caps.role)
      .replace(/\{num\}/g, padNum(caps.num, fmtMatch[1] + 'd'))
      .replace(/\{side\}/g, caps.suffix)
      .replace(/\{name\}/g, caps.raw)
      .replace(/_{2,}/g, '_')
      .replace(/^_+|_+$/g, '');
  }
  return out
    .replace(/\{prefix\}/g, caps.prefix)
    .replace(/\{role\}/g, caps.role)
    .replace(/\{num\}/g, caps.num)
    .replace(/\{side\}/g, caps.suffix)
    .replace(/\{name\}/g, caps.raw)
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
}

export const DEFAULT_PATTERN = '^(?<prefix>[A-Z]+)_(?<role>[A-Za-z]+)_?(?<num>\\d+)?$';
export const DEFAULT_TEMPLATE = '{prefix}_{role}_{num}';