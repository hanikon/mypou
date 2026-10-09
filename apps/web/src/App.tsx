import { useEffect } from 'preact/hooks';
import { Bubbles } from './games/Bubbles';
import { t } from './i18n';
import { Pet } from './pet/Pet';
import { RoomBackground } from './rooms/RoomBackground';
import { BathroomTray, BedroomTray, bubbles, jumping, KitchenTray, mouthOpen, petSvg, PlayroomTray } from './rooms/Trays';
import { emotion, load, loadState, overlay, pet, room, startClock, toast } from './state/store';
import { Nav, StatsBar } from './ui/Hud';
import { Shop } from './ui/Shop';

const TRAYS = { kitchen: KitchenTray, bathroom: BathroomTray, bedroom: BedroomTray, playroom: PlayroomTray };

export function App() {
  useEffect(() => {
    void load();
    return startClock();
  }, []);

  if (loadState.value === 'loading') {
    return (
      <div class="center">
        <div class="spinner" aria-hidden="true" />
        <p>{t().loading}</p>
      </div>
    );
  }
  if (loadState.value === 'error' || !pet.value) {
    return (
      <div class="center">
        <p>{t().loadError}</p>
        <button class="btn" onClick={() => void load()}>
          {t().retry}
        </button>
      </div>
    );
  }

  const p = pet.value;
  const Tray = TRAYS[room.value];
  const dark = room.value === 'bedroom' && p.sleeping;
  const ov = overlay.value;

  return (
    <div class="app">
      <StatsBar />
      <main class={`stage ${dark ? 'is-dark' : ''}`}>
        <RoomBackground room={room.value} wallpaper={p.wear.background} />
        <div class={`stage__pet ${jumping.value ? 'is-jumping' : ''}`}>
          <Pet state={p} emotion={emotion.value} mouthOpen={mouthOpen.value} svgRef={petSvg} />
        </div>
        {bubbles.value.map((b) => (
          <span key={b.id} class="soap-bubble" style={{ left: `${b.x}px`, top: `${b.y}px` }} />
        ))}
        {dark && <p class="stage__note">{t().bedroom.sleeping}</p>}
      </main>
      <Tray />
      <Nav />
      {ov?.kind === 'shop' && <Shop initialTab={ov.tab} />}
      {ov?.kind === 'game' && <Bubbles />}
      {toast.value && (
        <div class={`toast toast--${toast.value.kind}`} role="status">
          {toast.value.text}
        </div>
      )}
    </div>
  );
}
