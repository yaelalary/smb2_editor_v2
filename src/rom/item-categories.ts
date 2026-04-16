/**
 * Item categories for the tile library sidebar.
 *
 * Groups the 61 item types (0-60) into user-friendly categories per
 * the requirements doc (§4.1): blocks, doors, plants, platforms, etc.
 * Items within each category are ordered by frequency of use / logical
 * grouping, not by raw ID.
 */

/** MIME type for the drag-and-drop transfer payload. */
export const DRAG_MIME = 'application/smb2-item';

export interface ItemCategory {
  readonly label: string;
  readonly items: ReadonlyArray<number>;
}

export const ITEM_CATEGORIES: ReadonlyArray<ItemCategory> = [
  {
    label: 'Blocks',
    items: [0, 1, 2, 47, 48, 49, 53, 54],
  },
  {
    label: 'Doors & Entrances',
    items: [10, 9, 11, 19, 20, 21, 28, 29, 30],
  },
  {
    label: 'Herbs & Pickups',
    items: [32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 45],
  },
  {
    label: 'Vegetation',
    items: [3, 12, 13, 18, 22],
  },
  {
    label: 'Platforms & Ground',
    items: [5, 15, 23, 24, 25, 31, 51, 52, 55, 57, 58, 59],
  },
  {
    label: 'Background',
    items: [14, 16, 17],
  },
  {
    label: 'Jars',
    items: [4, 6, 7, 8],
  },
  {
    label: 'Special',
    items: [26, 27, 44, 46, 56, 60],
  },
];
