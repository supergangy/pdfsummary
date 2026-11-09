import { registerRootComponent } from "expo";
import type { ComponentType } from "react";

export function boot(load: () => ComponentType) {
  registerRootComponent(load());
}
