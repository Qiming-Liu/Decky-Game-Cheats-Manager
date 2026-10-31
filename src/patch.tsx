/**
 * Adapted from CheatDeck (https://github.com/SheffeyG/CheatDeck/blob/main/src/patch.tsx),
 * itself credited to decky-steamgriddb's contextMenuPatch.tsx. Same react-patching
 * technique, renamed for the "DeckyGCM" menu item and its own route.
 */

import {
  afterPatch,
  type Export,
  fakeRenderComponent,
  findInReactTree,
  findInTree,
  findModuleByExport,
  MenuItem,
  Navigation,
  type Patch,
} from "@decky/ui";
import type { FC } from "react";

import { menuItemLabel } from "./utils/i18n";
import { gamePageRoute } from "./utils/routes";

const MENU_ITEM_KEY = "game-cheats-manager";

// Always add before "Properties..."
const spliceMenuItem = (children: any[], appid: number) => {
  const propertiesMenuItemIdx = children.findIndex((item) =>
    findInReactTree(item, (x) => x?.onSelected?.toString().includes("AppProperties")),
  );
  children.splice(
    propertiesMenuItemIdx < 0 ? children.length : propertiesMenuItemIdx,
    0,
    <MenuItem
      key={MENU_ITEM_KEY}
      onSelected={() => {
        Navigation.Navigate(gamePageRoute(appid));
      }}
    >
      {menuItemLabel()}
    </MenuItem>,
  );
};

// Check if correct menu by looking at the code of the onSelected function.
// Should be enough to ignore the screenshots and other menus.
const isOpeningAppContextMenu = (items: any[]) => {
  if (!items?.length) {
    return false;
  }
  return !!findInReactTree(items, (x) => x?.props?.onSelected?.toString().includes("launchSource"));
};

const handleItemDupes = (items: any[]) => {
  const existingIdx = items.findIndex((x: any) => x?.key === MENU_ITEM_KEY);
  if (existingIdx !== -1) items.splice(existingIdx, 1);
};

const patchMenuItems = (menuItems: any[], appid: number) => {
  let updatedAppid: number = appid;
  // find the first menu component that has the correct appid, sometimes the one passed is cached from another context menu
  const parentOverview = menuItems.find(
    (x: any) => x?._owner?.pendingProps?.overview?.appid && x._owner.pendingProps.overview.appid !== appid,
  );
  if (parentOverview) {
    updatedAppid = parentOverview._owner.pendingProps.overview.appid;
  }
  if (updatedAppid === appid) {
    const foundApp = findInTree(menuItems, (x) => x?.app?.appid, { walkable: ["props", "children"] });
    if (foundApp) {
      updatedAppid = foundApp.app.appid;
    }
  }
  spliceMenuItem(menuItems, updatedAppid);
};

/** Install lazily: a Steam menu change must not prevent the sidebar loading. */
export default function installGameMenu(): () => void {
  const patches: Patch[] = [];
  const prototypes = new WeakSet<object>();
  const components = new WeakSet<object>();
  let currentAppId = 0;
  const cleanup = () => { for (const patch of patches.splice(0).reverse()) patch.unpatch(); };
  const update = (items: any[], appid: number) => {
    if (!Array.isArray(items) || !isOpeningAppContextMenu(items)) return;
    handleItemDupes(items);
    patchMenuItems(items, appid);
  };
  try {
    const module = findModuleByExport((e: Export) => e?.toString?.().includes("().LibraryContextMenu"));
    const factory = Object.values(module || {}).find((sibling) => sibling?.toString().includes("navigator:"));
    if (!factory) return cleanup;
    const LibraryContextMenu = fakeRenderComponent(factory as FC)?.type;
    if (!LibraryContextMenu?.prototype?.render) return cleanup;
    patches.push(afterPatch(LibraryContextMenu.prototype, "render", (_: any, component: any) => {
      const overviewId = component?._owner?.pendingProps?.overview?.appid;
      const found = findInTree(component?.props?.children, (x) => x?.app?.appid, { walkable: ["props", "children"] });
      const appid = overviewId ?? found?.app?.appid;
      if (!appid) return component;
      currentAppId = appid;
      if (!components.has(component) && typeof component.type === "function") {
        components.add(component);
        patches.push(afterPatch(component, "type", (_: any, ret: any) => {
          const proto = ret?.type?.prototype;
          if (!proto?.render || prototypes.has(proto)) return ret;
          prototypes.add(proto);
          patches.push(afterPatch(proto, "render", (_: any, rendered: any) => {
            update(rendered?.props?.children?.[0], currentAppId);
            return rendered;
          }));
          if (proto.shouldComponentUpdate) patches.push(afterPatch(proto, "shouldComponentUpdate", ([next]: any, result: any) => {
            if (result === true) update(next?.children, currentAppId);
            return result;
          }));
          return ret;
        }));
      }
      update(component?.props?.children, appid);
      return component;
    }));
  } catch {
    cleanup();
  }
  return cleanup;
}
