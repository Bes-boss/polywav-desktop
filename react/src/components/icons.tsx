// ============================================================
// components/icons.tsx — custom SVG icon set (Polywav design)
// 24x24 viewBox, 1.7 stroke, round caps/joins, currentColor.
// No glyphs, no emoji: every icon hand-drawn to match the UI.
// ============================================================
import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: P): SVGProps<SVGSVGElement> {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.7,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...rest,
  };
}

/** Home — house with a centered door */
export function IconHome(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M3 10.5 12 3.5l9 7" />
      <path d="M5 9.5V20h14V9.5" />
      <path d="M9.5 20v-5h5v5" />
    </svg>
  );
}

/** Normalize — text lines with a pen nib adjusting the top line */
export function IconNormalize(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M4 7h9.5" />
      <path d="M4 11.5h7" />
      <path d="M4 16h11" />
      <path d="M18.6 4.2a1.7 1.7 0 0 1 2.4 2.4l-6.7 6.7-3 .8.8-3z" />
    </svg>
  );
}

/** Route — branching signal: source dot feeding two destinations */
export function IconRoute(p: P) {
  return (
    <svg {...base(p)}>
      <circle cx="4.5" cy="17" r="1.9" />
      <path d="M6.4 17H12l3-6" />
      <circle cx="18" cy="8.5" r="1.9" />
      <circle cx="18" cy="17" r="1.9" />
      <path d="M18 10.4V15" />
    </svg>
  );
}

/** Patch bay — a jack plug being inserted into a jackfield */
export function IconPatch(p: P) {
  return (
    <svg {...base(p)}>
      <rect x="2.5" y="6" width="5.5" height="13" rx="1.2" />
      <rect x="16" y="6" width="5.5" height="13" rx="1.2" />
      <circle cx="5.25" cy="9.3" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="5.25" cy="13" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="5.25" cy="16.7" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="18.75" cy="9.3" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="18.75" cy="13" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="18.75" cy="16.7" r="0.9" fill="currentColor" stroke="none" />
      <path d="M10.5 9.5c1.4-1.2 2.4-1.2 3 0" />
      <path d="M10.5 13.5c1.4-1.2 2.4-1.2 3 0" />
    </svg>
  );
}

/** Export — download into a tray */
export function IconExport(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M12 4v10" />
      <path d="m7.5 9.5 4.5 4.5 4.5-4.5" />
      <path d="M4 17.5h16" />
    </svg>
  );
}

/** Home-tab export header button (matches app header action) */
export function IconExportHeader(p: P) {
  return (
    <svg {...base({ ...p, size: p.size ?? 15 })}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <path d="m7 10 5 5 5-5" />
      <path d="M12 15V3" />
    </svg>
  );
}

/** Settings — precision gear */
export function IconGear(p: P) {
  return (
    <svg {...base({ ...p, size: p.size ?? 16 })}>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 2.8v2.3M12 18.9v2.3M2.8 12h2.3M18.9 12h2.3M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6" />
    </svg>
  );
}

/** Wizard sparkle — four-point star */
export function IconSparkle(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M12 3.5c.6 4.6 3.4 7.4 8 8-4.6.6-7.4 3.4-8 8-.6-4.6-3.4-7.4-8-8 4.6-.6 7.4-3.4 8-8z" />
      <path d="M18.5 16.5c.25 1.6 1.2 2.5 2.8 2.8-1.6.3-2.55 1.2-2.8 2.8-.25-1.6-1.2-2.5-2.8-2.8 1.6-.3 2.55-1.2 2.8-2.8z" opacity="0.8" />
    </svg>
  );
}

/** Upload — arrow up into a tray (drop zone) */
export function IconUpload(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M12 15.5V4.5" />
      <path d="m7 9 5-5 5 5" />
      <path d="M4 18.5h16" opacity="0.45" />
    </svg>
  );
}

/** Folder */
export function IconFolder(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M3 6.5a1.8 1.8 0 0 1 1.8-1.8h4.4l2 2.2h7a1.8 1.8 0 0 1 1.8 1.8v8.9a1.8 1.8 0 0 1-1.8 1.8H4.8A1.8 1.8 0 0 1 3 17.4z" />
    </svg>
  );
}

/** Audio file waveform */
export function IconWave(p: P) {
  return (
    <svg {...base(p)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M7.5 9.5v5M10.5 8v8M13.5 10v4M16.5 9.5v5" strokeWidth="1.3" />
    </svg>
  );
}

/** Undo arrow */
export function IconUndo(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M8.5 5 3.5 9.5 8.5 14" />
      <path d="M3.5 9.5H15a5 5 0 1 1 0 10h-2.5" />
    </svg>
  );
}

/** Redo arrow */
export function IconRedo(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M15.5 5l5 4.5-5 4.5" />
      <path d="M20.5 9.5H9a5 5 0 1 0 0 10h2.5" />
    </svg>
  );
}

/** Copy — two sheets */
export function IconCopy(p: P) {
  return (
    <svg {...base(p)}>
      <rect x="8" y="8" width="12" height="12.5" rx="1.8" />
      <path d="M16 8V6a2 2 0 0 0-2-2H5.5A2 2 0 0 0 3.5 6v9.5a2 2 0 0 0 2 2H8" />
    </svg>
  );
}

/** Close X */
export function IconX(p: P) {
  return (
    <svg {...base(p)}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  );
}

/** Chevron up (stack-order controls) */
export function IconChevronUp(p: P) {
  return (
    <svg {...base(p)}>
      <path d="m6 14.5 6-6 6 6" />
    </svg>
  );
}

/** Chevron down */
export function IconChevronDown(p: P) {
  return (
    <svg {...base(p)}>
      <path d="m6 9.5 6 6 6-6" />
    </svg>
  );
}

/** Chevron right (CTA arrow) */
export function IconChevronRight(p: P) {
  return (
    <svg {...base(p)}>
      <path d="m9.5 6 6 6-6 6" />
    </svg>
  );
}

/** Window controls */
export function IconWinMin(p: P) {
  return (
    <svg {...base({ ...p, size: p.size ?? 13, strokeWidth: 1.8 })}>
      <path d="M4 12h16" />
    </svg>
  );
}
export function IconWinMax(p: P) {
  return (
    <svg {...base({ ...p, size: p.size ?? 12, strokeWidth: 1.4 })}>
      <rect x="4" y="4" width="16" height="16" rx="1.5" />
    </svg>
  );
}
export function IconWinRestore(p: P) {
  return (
    <svg {...base({ ...p, size: p.size ?? 12, strokeWidth: 1.4 })}>
      <rect x="4.5" y="7" width="12.5" height="12.5" rx="1.5" />
      <path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4H18a1.5 1.5 0 0 1 1.5 1.5V14A1.5 1.5 0 0 1 18 15.5h-1.5" />
    </svg>
  );
}
export function IconWinClose(p: P) {
  return (
    <svg {...base({ ...p, size: p.size ?? 12, strokeWidth: 1.8 })}>
      <path d="m5 5 14 14M19 5 5 19" />
    </svg>
  );
}

/** Drag handle (grip dots) */
export function IconGrip(p: P) {
  return (
    <svg {...base({ ...p, strokeWidth: 1.9 })}>
      <circle cx="9" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="18" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="18" r="1" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Plus */
export function IconPlus(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** Wand/parse — magic wand */
export function IconWand(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M14.5 6.5 17.5 9.5 8 19a2 2 0 0 1-2.8 0l-.7-.7a2 2 0 0 1 0-2.8z" />
      <path d="m12.5 8.5 3 3" opacity="0.55" />
      <path d="M18.5 3v3M20.5 4.5h-3" />
    </svg>
  );
}

/** Speaker/level — for normalize/badge */
export function IconLevel(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M5 10v4h3l4 3V7L8 10z" />
      <path d="M15.5 9.5a3.5 3.5 0 0 1 0 5" opacity="0.7" />
    </svg>
  );
}

/** Plug — small jack for patch chips */
export function IconPlug(p: P) {
  return (
    <svg {...base(p)}>
      <rect x="8" y="8" width="8" height="12" rx="1.5" />
      <path d="M12 8V5" />
      <path d="M9 5h6" />
      <path d="M12 13v2" opacity="0.6" />
    </svg>
  );
}

/** Wizard template icons */
export function IconTV(p: P) {
  return (
    <svg {...base(p)}>
      <rect x="3" y="5.5" width="18" height="12.5" rx="2" />
      <path d="m10 18-1.5 3M14 18l1.5 3M11 18l1 3M13 18l-1 3" />
    </svg>
  );
}
export function IconCook(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M6 12.5h12v6.5a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 19z" />
      <path d="M6 12.5c0-4.5 12-4.5 12 0" opacity="0.6" />
      <path d="M12 6v2.6" />
      <path d="M9.5 6v1.2M14.5 6v1.2" />
    </svg>
  );
}
export function IconMusicNote(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M9 18.5V6l11-2.5v12.5" />
      <path d="M9 18.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z" />
      <path d="M20 16a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z" />
    </svg>
  );
}
export function IconSliders(p: P) {
  return (
    <svg {...base(p)}>
      <path d="M5 21V14M5 10V3M12 21v-8M12 9V3M19 21v-4M19 13V3" />
      <path d="M3 14h4M10 9h4M17 13h4" />
    </svg>
  );
}