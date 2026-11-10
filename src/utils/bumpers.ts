import { GamepadButton, GamepadEvent } from "@decky/ui";

/**
 * A gamepad handler that turns L1/R1 into a step of -1/+1, so a page's choices (option groups,
 * list pages) switch from anywhere on the page, the way Steam's own tabs do. Other buttons pass through.
 */
export function bumperStep(step: (direction: -1 | 1) => void) {
  return (event: GamepadEvent) => {
    const button = event.detail.button;
    if (button !== GamepadButton.BUMPER_LEFT && button !== GamepadButton.BUMPER_RIGHT) return;
    event.stopPropagation();
    step(button === GamepadButton.BUMPER_LEFT ? -1 : 1);
  };
}
