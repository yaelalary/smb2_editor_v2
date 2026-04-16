/**
 * Property commands — mutate level header fields.
 *
 * Each command captures a reference to the level header at construction
 * time. The `execute` and `undo` methods mutate the field directly via
 * a Mutable type assertion — this is the controlled escape hatch from
 * the model's `readonly` annotations, per AGENTS.md.
 *
 * The `sourceBytes` field on the header is NOT updated here; the
 * serializer's `headerMatchesSource` check detects the stale source
 * bytes and triggers constructive packing automatically.
 */

import type { Command, Mutable } from './types';
import type { LevelHeader } from '@/rom/model';

/** Editable numeric fields on the level header. */
export type EditableHeaderField =
  | 'direction'
  | 'palette'
  | 'enemyColor'
  | 'groundSet'
  | 'length'
  | 'objectType'
  | 'groundType'
  | 'music';

const FIELD_LABELS: Record<EditableHeaderField, string> = {
  direction: 'Direction',
  palette: 'Palette',
  enemyColor: 'Enemy color',
  groundSet: 'Ground set',
  length: 'Length',
  objectType: 'Object type',
  groundType: 'Ground type',
  music: 'Music',
};

export class SetLevelFieldCommand implements Command {
  readonly label: string;
  readonly targetSlot?: number;

  private readonly header: Mutable<LevelHeader>;
  private readonly field: EditableHeaderField;
  private readonly newValue: number;
  private readonly oldValue: number;

  constructor(
    header: LevelHeader,
    field: EditableHeaderField,
    newValue: number,
    targetSlot?: number,
  ) {
    // Capture a mutable reference to the header. The readonly annotation
    // is a TypeScript-level guard; at runtime the object IS mutable.
    this.header = header as Mutable<LevelHeader>;
    this.field = field;
    this.newValue = newValue;
    this.oldValue = header[field];
    this.targetSlot = targetSlot;
    this.label = `Set ${FIELD_LABELS[field]} → ${newValue}`;
  }

  execute(): void {
    this.header[this.field] = this.newValue;
  }

  undo(): void {
    this.header[this.field] = this.oldValue;
  }
}
