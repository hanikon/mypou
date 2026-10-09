import data from './catalog/items.json';

export type Slot = 'color' | 'hat' | 'glasses' | 'outfit' | 'background' | 'food';
export type WearSlot = Exclude<Slot, 'food'>;
export const WEAR_SLOTS: WearSlot[] = ['color', 'hat', 'glasses', 'outfit', 'background'];

export interface SvgShape {
  el: 'path' | 'circle' | 'ellipse' | 'rect' | 'polygon' | 'line';
  a: Record<string, string>;
}

export interface Item {
  id: string;
  slot: Slot;
  price: number;
  name: { ru: string; en: string };
  /** Цвет тела (slot=color) или цвет узора (slot=background). */
  color?: string;
  pattern?: 'dots' | 'stripes' | 'stars' | 'waves';
  svg?: SvgShape[];
  food?: { satiety: number; mood: number };
}

export const ITEMS: Item[] = data.items as Item[];
const byId = new Map(ITEMS.map((i) => [i.id, i]));

export const getItem = (id: string | undefined): Item | undefined =>
  id === undefined ? undefined : byId.get(id);

export const itemsBySlot = (slot: Slot) => ITEMS.filter((i) => i.slot === slot);

/** Бесплатные предметы есть у всех с самого начала. */
export const FREE_ITEMS = ITEMS.filter((i) => i.price === 0 && i.slot !== 'food').map((i) => i.id);
