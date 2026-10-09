import { getItem } from '@kaplya/shared';
import type { Room } from '../state/store';

const WALL: Record<Room, string> = {
  kitchen: '#ffe8c2',
  bathroom: '#cdeffd',
  bedroom: '#d9d2ff',
  playroom: '#d4f5d0',
};
const FLOOR: Record<Room, string> = {
  kitchen: '#d9a46c',
  bathroom: '#e9f4f7',
  bedroom: '#a98bd6',
  playroom: '#9ad17f',
};

/** Фон комнаты: стена (с узором из магазина), пол и пара предметов обстановки. */
export function RoomBackground({ room, wallpaper }: { room: Room; wallpaper?: string }) {
  const wp = getItem(wallpaper);
  return (
    <svg class="room-bg" viewBox="0 0 400 700" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
      <defs>
        <pattern id="wp-dots" width="40" height="40" patternUnits="userSpaceOnUse">
          <circle cx="20" cy="20" r="5" fill={wp?.color} opacity="0.55" />
        </pattern>
        <pattern id="wp-stripes" width="40" height="40" patternUnits="userSpaceOnUse">
          <rect width="16" height="40" fill={wp?.color} opacity="0.4" />
        </pattern>
        <pattern id="wp-stars" width="60" height="60" patternUnits="userSpaceOnUse">
          <path d="M30 14 L34 26 L46 26 L36 33 L40 45 L30 37 L20 45 L24 33 L14 26 L26 26 Z" fill={wp?.color} opacity="0.6" />
        </pattern>
        <pattern id="wp-waves" width="60" height="24" patternUnits="userSpaceOnUse">
          <path d="M0 12 Q15 0 30 12 T60 12" fill="none" stroke={wp?.color} stroke-width="4" opacity="0.5" />
        </pattern>
      </defs>
      <rect width="400" height="520" fill={WALL[room]} />
      {wp?.pattern && <rect width="400" height="520" fill={`url(#wp-${wp.pattern})`} />}
      <rect y="520" width="400" height="180" fill={FLOOR[room]} />
      <rect y="514" width="400" height="10" fill="#000" opacity="0.08" />
      {room === 'kitchen' && (
        <g>
          <rect x="250" y="300" width="120" height="220" rx="12" fill="#f1f3f5" stroke="#ced4da" stroke-width="4" />
          <line x1="250" y1="380" x2="370" y2="380" stroke="#ced4da" stroke-width="4" />
          <rect x="350" y="320" width="8" height="40" rx="4" fill="#adb5bd" />
          <circle cx="90" cy="150" r="40" fill="#fff" stroke="#e76f51" stroke-width="6" />
          <path d="M90 150 V125 M90 150 H110" stroke="#2b2d42" stroke-width="4" stroke-linecap="round" />
        </g>
      )}
      {room === 'bathroom' && (
        <g>
          <path d="M20 430 H220 V470 Q220 520 170 520 H70 Q20 520 20 470 Z" fill="#fff" stroke="#90e0ef" stroke-width="5" />
          <rect x="40" y="350" width="12" height="80" fill="#adb5bd" />
          <path d="M46 350 Q46 330 70 330 H90" stroke="#adb5bd" stroke-width="8" fill="none" />
          <rect x="280" y="120" width="80" height="110" rx="40" fill="#e0fbfc" stroke="#90e0ef" stroke-width="5" />
        </g>
      )}
      {room === 'bedroom' && (
        <g>
          <rect x="260" y="110" width="110" height="130" rx="10" fill="#1d3557" stroke="#fff" stroke-width="8" />
          <circle cx="330" cy="160" r="20" fill="#ffd166" />
          <circle cx="322" cy="154" r="20" fill="#1d3557" />
          <rect x="20" y="440" width="180" height="80" rx="16" fill="#ffafcc" />
          <rect x="30" y="420" width="60" height="30" rx="12" fill="#fff" />
        </g>
      )}
      {room === 'playroom' && (
        <g>
          <circle cx="330" cy="490" r="30" fill="#ef476f" />
          <path d="M300 490 H360 M330 460 V520" stroke="#ffd166" stroke-width="6" />
          <rect x="30" y="460" width="60" height="60" fill="#118ab2" rx="6" />
          <rect x="45" y="420" width="44" height="44" fill="#06d6a0" rx="6" />
          <polygon points="60,140 80,180 40,180" fill="#ffd166" />
          <polygon points="320,100 340,140 300,140" fill="#ef476f" />
        </g>
      )}
    </svg>
  );
}
