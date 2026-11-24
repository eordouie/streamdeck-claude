import {
  action,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
  WillDisappearEvent,
  type KeyAction,
} from "@elgato/streamdeck";

/** The arrow key: flips the plugin's two pages of agents. */
@action({ UUID: "com.eordouie.herdrdeck.pager" })
export class PagerKey extends SingletonAction {
  private readonly instances = new Map<string, KeyAction>();

  constructor(
    private readonly onPress: () => void,
    private readonly onKeysChanged: (id: string) => void,
  ) {
    super();
  }

  override onWillAppear(ev: WillAppearEvent): void {
    if (!ev.action.isKey()) return;
    this.instances.set(ev.action.id, ev.action);
    this.onKeysChanged(ev.action.id);
  }

  override onWillDisappear(ev: WillDisappearEvent): void {
    this.instances.delete(ev.action.id);
    this.onKeysChanged(ev.action.id);
  }

  override onKeyDown(_ev: KeyDownEvent): void {
    this.onPress();
  }

  keys(): KeyAction[] {
    return [...this.instances.values()];
  }
}
