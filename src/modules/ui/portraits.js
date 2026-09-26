// Little painted SVG portraits for the character switcher (head-and-shoulders, ink + wash).
import { palette } from '../../core/palette.js';

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

const BG = ['#c9d3b0', '#d9c7a0', '#b9c9c9', '#d8b9a4', '#c4bfd6', '#cfd6b8'];
const HAIR_STYLES = ['short', 'long', 'cap', 'bun', 'bald', 'curly'];

/** c: { id, name, skin?, hair?, cloth?, style? } — missing fields are derived from the id */
export function portrait(c) {
  const h = hash(String(c.id || c.name || 'x'));
  const skin = c.skin || palette.skin[h % palette.skin.length];
  const hair = c.hair || palette.hair[(h >>> 3) % palette.hair.length];
  const cloth = c.cloth || palette.cloth[(h >>> 6) % palette.cloth.length];
  const bg = BG[(h >>> 9) % BG.length];
  const style = c.style || HAIR_STYLES[(h >>> 12) % HAIR_STYLES.length];
  const ink = '#3a2e22';
  let hairBack = '', hairFront = '';
  switch (style) {
    case 'long': hairBack = `<path d="M13.4 22c-1.4 7 .2 13.6 2.4 16.6h16.4c2.2-3 3.8-9.6 2.4-16.6-1.2-6.2-5.4-9.6-10.6-9.6s-9.4 3.4-10.6 9.6z" fill="${hair}"/>`;
      hairFront = `<path d="M15.4 22.6c1.6-4.8 5-7 8.6-7s7 2.2 8.6 7c-3.4-1.4-6.8-2.6-10.2-4.4-1.6 2-4 3.6-7 4.4z" fill="${hair}"/>`; break;
    case 'cap': hairFront = `<path d="M14.4 21.4c.6-5.4 4.6-8.4 9.6-8.4s9 3 9.6 8.4z" fill="${cloth === '#3f5f86' ? '#8a3a30' : '#3f5f86'}" stroke="${ink}" stroke-width=".8"/><path d="M13 21.4h19.6c1.6 0 2.8.6 3.4 1.6H13z" fill="#2e3f5c" stroke="${ink}" stroke-width=".7"/>`; break;
    case 'bun': hairBack = `<circle cx="24" cy="12.6" r="4" fill="${hair}"/>`; hairFront = `<path d="M15 23.4c.4-5.8 4.2-8.6 9-8.6s8.6 2.8 9 8.6c-2.2-2.8-5.4-4.4-9-4.4s-6.8 1.6-9 4.4z" fill="${hair}"/>`; break;
    case 'bald': hairFront = `<path d="M15.4 25.4c-.8-1.2-.8-2.6 0-3.6M32.6 25.4c.8-1.2.8-2.6 0-3.6" stroke="${hair}" stroke-width="2.2" stroke-linecap="round" fill="none"/>`; break;
    case 'curly': hairFront = `<path d="M14.8 24c-1.6-2.6-.4-5.6 1.8-6.6.2-2.6 2.8-4.2 5.2-3.4 1.6-1.6 4.6-1.4 5.8.4 2.6-.2 4.6 2 4.2 4.4 2 1.2 2.4 3.6 1.4 5.2-2.6-2.2-5.6-3.2-9.2-3.2s-6.6 1-9.2 3.2z" fill="${hair}"/>`; break;
    default: hairFront = `<path d="M15 23.6c-.2-6 3.8-9.2 9-9.2 5 0 9 3 8.8 9-1.8-2.4-4.2-3.6-6.8-3.8-1.2 1.2-3.6 1.8-6 1.6-2 .4-3.8 1.2-5 2.4z" fill="${hair}"/>`;
  }
  return `<svg viewBox="0 0 48 48" aria-hidden="true">
    <rect width="48" height="48" fill="${bg}"/>
    <circle cx="16" cy="12" r="14" fill="#fff8e6" opacity=".25"/>
    ${hairBack}
    <path d="M6 50c.8-9 7.4-13.8 18-13.8S41.2 41 42 50z" fill="${cloth}" stroke="${ink}" stroke-width=".9" stroke-opacity=".6"/>
    <path d="M19.6 36.6c1.2 2.2 2.6 3.2 4.4 3.2s3.2-1 4.4-3.2" fill="none" stroke="${ink}" stroke-opacity=".45" stroke-width=".9"/>
    <path d="M20.6 31.4h6.8v5.8c-1 1.2-2.2 1.8-3.4 1.8s-2.4-.6-3.4-1.8z" fill="${skin}"/>
    <path d="M24 13.8c5.4 0 8.8 4 8.8 9.6 0 6.6-4 10.8-8.8 10.8s-8.8-4.2-8.8-10.8c0-5.6 3.4-9.6 8.8-9.6z" fill="${skin}" stroke="${ink}" stroke-width=".9" stroke-opacity=".55"/>
    <path d="M24 13.8c5.4 0 8.8 4 8.8 9.6 0 6.6-4 10.8-8.8 10.8" fill="#3a2010" opacity=".08"/>
    <circle cx="20.6" cy="24.4" r="1.05" fill="${ink}"/><circle cx="27.4" cy="24.4" r="1.05" fill="${ink}"/>
    <path d="M21.4 29.4c1.6 1 3.6 1 5.2 0" fill="none" stroke="${ink}" stroke-width=".9" stroke-linecap="round" stroke-opacity=".7"/>
    <circle cx="19" cy="27.6" r="1.8" fill="#d0705a" opacity=".22"/><circle cx="29" cy="27.6" r="1.8" fill="#d0705a" opacity=".22"/>
    ${hairFront}
  </svg>`;
}
