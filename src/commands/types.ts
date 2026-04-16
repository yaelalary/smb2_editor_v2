/**
 * Command interface — the contract every model mutation implements.
 *
 * Commands are the ONLY way to mutate the parsed ROM model. The model
 * is exposed as `DeepReadonly<T>` to all components; commands bypass
 * this via a controlled type assertion inside their execute/undo
 * methods. This makes it structurally impossible to change the model
 * without going through the undo/redo stack.
 *
 * Per AGENTS.md: "Execute via useHistoryStore().execute(cmd). Nowhere else."
 */

/** Utility: strips `readonly` from all properties. */
export type Mutable<T> = { -readonly [P in keyof T]: T[P] };

export interface Command {
  /** Human-readable description shown in undo menu / notifications. */
  readonly label: string;

  /**
   * Which level slot this command targets. Used for off-screen undo
   * notifications: if the user undoes a command that targets a different
   * slot than the one currently viewed, a toast shows the label + slot.
   */
  readonly targetSlot?: number;

  /** Apply the mutation. Called once on first execute, again on redo. */
  execute(): void;

  /** Reverse the mutation. Called on undo. */
  undo(): void;
}
