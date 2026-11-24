import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  type KeyAction,
} from "@elgato/streamdeck";

import { keyIndex } from "./press.js";

/** One key that shows one herdr agent. Which agent is decided by the key's
 *  place among all agent keys, top to bottom, left to right. */
@action({ UUID: "com.eordouie.herdrdeck.agent" })
export class AgentKey extends SingletonAction {
  private readonly instances = new Map<string, KeyAction>();

  constructor(
    private readonly onPress: (key: KeyAction) => void,
    private readonly onKeysChanged: (id: string) => void,
  ) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent): void {
    if (!ev.action.isKey() || keyIndex(ev.action.coordinates) === undefined) return;
    this.instances.set(ev.action.id, ev.action);
    this.onKeysChanged(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    this.instances.delete(ev.action.id);
    this.onKeysChanged(ev.action.id);
  }

  override onKeyDown(ev: KeyDownEvent): void {
    const key = this.instances.get(ev.action.id);
    if (key) this.onPress(key);
  }

  keys(): Iterable<KeyAction> { return this.instances.values(); }
}
