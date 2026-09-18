/**
 * Wilson state / presence boundary types.
 *
 * Longer-term conceptual architecture:
 *   WilsonCore -> WilsonState -> WilsonPresence -> Visual Renderer
 *
 * Core can emit state such as idle / listening / thinking / speaking.
 * State may carry an intensity / audio level.
 * Presence / renderer owns visual presentation. Core does not own rendering.
 *
 * Proposal #1: types only. No runtime wiring.
 */

export type WilsonPresenceState =
  | "idle"
  | "listening"
  | "thinking"
  | "speaking";

export interface WilsonState {
  presence: WilsonPresenceState;
  /** 0..1 intensity, e.g. audio level or thinking load. */
  intensity?: number;
  updatedAt: number;
}

export type WilsonEventType =
  | "state_changed"
  | "presence_changed"
  | "error";

export interface WilsonEvent {
  type: WilsonEventType;
  at: number;
  payload?: unknown;
}

export type WilsonEventListener = (event: WilsonEvent) => void;
