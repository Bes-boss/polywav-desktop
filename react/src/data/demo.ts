// Demo data for the React shell (sample strings, not extracted data).
// Mirrors the wireframe mock: EP03 shoot day, 6 takes, panel-show layout.

export interface DemoChannel {
  raw: string;
  name: string;
  bext: string;
}

export const PANEL_CHANNELS: DemoChannel[] = [
  { raw: 'MIX_L_01', name: 'Mix L', bext: 'L' },
  { raw: 'MIX_R_02', name: 'Mix R', bext: 'R' },
  { raw: 'LAV_CAM1_03', name: 'Lav Cam 1', bext: 'CAM 1' },
  { raw: 'LAV_CAM2_04', name: 'Lav Cam 2', bext: 'CAM 2' },
  { raw: 'LAV_DESK_05', name: 'Lav Desk', bext: 'DESK' },
  { raw: 'BOOM_01', name: 'Boom 1', bext: 'BOOM' },
  { raw: 'MUS_01', name: 'Music 1', bext: 'MUS 1' },
  { raw: 'MUS_02', name: 'Music 2', bext: 'MUS 2' },
  { raw: 'ISO_1', name: 'ISO 1', bext: 'ISO' },
  { raw: 'ISO_2', name: 'ISO 2', bext: 'ISO' },
  { raw: 'ISO_3', name: 'ISO 3', bext: 'ISO' },
  { raw: 'ISO_4', name: 'ISO 4', bext: 'ISO' },
  { raw: 'TC_01', name: 'TC', bext: 'TC' },
  { raw: 'SLATE_01', name: 'Slate', bext: 'SLATE' },
];

export function buildTakeChannels(total: number): DemoChannel[] {
  if (total <= PANEL_CHANNELS.length) return PANEL_CHANNELS.slice(0, total);
  const extra: DemoChannel[] = [];
  for (let i = PANEL_CHANNELS.length + 1; i <= total; i++) {
    extra.push({ raw: `ISO_${i}`, name: `ISO ${i}`, bext: 'ISO' });
  }
  return [...PANEL_CHANNELS, ...extra];
}

export interface Take {
  id: string;
  name: string;
  path: string;
  channels: number;
  sampleRate: number;
  bits: number;
}

export const DEMO_FOLDER = 'D:\\shoots\\EP03\\audio';
export const DEMO_TAKES: Take[] = [
  { id: 'T01', name: 'EP03_S1_T01.WAV', path: `${DEMO_FOLDER}\\EP03_S1_T01.WAV`, channels: 14, sampleRate: 48000, bits: 24 },
  { id: 'T02', name: 'EP03_S1_T02.WAV', path: `${DEMO_FOLDER}\\EP03_S1_T02.WAV`, channels: 14, sampleRate: 48000, bits: 24 },
  { id: 'T03', name: 'EP03_S1_T03.WAV', path: `${DEMO_FOLDER}\\EP03_S1_T03.WAV`, channels: 14, sampleRate: 48000, bits: 24 },
  { id: 'T04', name: 'EP03_S1_T04.WAV', path: `${DEMO_FOLDER}\\EP03_S1_T04.WAV`, channels: 14, sampleRate: 48000, bits: 24 },
  { id: 'T05', name: 'EP03_S1_T05.WAV', path: `${DEMO_FOLDER}\\EP03_S1_T05.WAV`, channels: 14, sampleRate: 48000, bits: 24 },
  { id: 'T06', name: 'EP03_S1_T06_MIX.WAV', path: `${DEMO_FOLDER}\\EP03_S1_T06_MIX.WAV`, channels: 94, sampleRate: 48000, bits: 24 },
];

export interface TrackGroupDef {
  name: string;
  tracks: string[]; // 'A1'..'A64'
  color: string;
}

export const AO_COLORS = ['#c4664a', '#c8a96e', '#7a9e8c', '#7f8fa0', '#b088c8', '#6ab0c0', '#d4a76a', '#9cb87e'];

export const DEMO_GROUPS: TrackGroupDef[] = [
  { name: 'Final Mix', tracks: ['A1', 'A2'], color: AO_COLORS[0] },
  { name: 'Contestants', tracks: ['A3', 'A4'], color: AO_COLORS[1] },
  { name: 'Boom', tracks: ['A5'], color: AO_COLORS[2] },
  { name: 'Music & FX', tracks: ['A6', 'A7', 'A8'], color: AO_COLORS[3] },
];

// Default template routing per channel role (auto-assign).
export function defaultTrackFor(chIndex: number): string | null {
  switch (chIndex) {
    case 0: return 'A1'; // Mix L
    case 1: return 'A2'; // Mix R
    case 2: return 'A3'; // Lav Cam 1
    case 3: return 'A4'; // Lav Cam 2
    case 4: return 'A4'; // Lav Desk (shared track)
    case 5: return 'A5'; // Boom 1
    case 6: return 'A6'; // Music 1
    case 7: return 'A7'; // Music 2
    default: return null; // ISO/TC/Slate unassigned
  }
}

export function groupForTrack(track: string | null): { name: string; color: string } | null {
  if (!track) return null;
  for (const g of DEMO_GROUPS) {
    if (g.tracks.includes(track)) return { name: g.name, color: g.color };
  }
  return null;
}

export function trackRangeLabel(tracks: string[]): string {
  if (!tracks.length) return '';
  const nums = tracks.map((t) => parseInt(t.slice(1), 10));
  return `A${Math.min(...nums)} – A${Math.max(...nums)}`;
}