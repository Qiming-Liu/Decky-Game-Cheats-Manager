/**
 * Library context-menu patch that adds the "DeckyGCM" menu item and opens its route.
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
const APP_PROPERTIES_ITEM = "AppProperties";

const hasOnSelected = (item: any, marker: string) => {
  const onSelected = item?.onSelected ?? item?.props?.onSelected;
  return typeof onSelected === "function" && onSelected.toString().includes(marker);
};

const containsMenuItem = (item: any, marker: string) =>
  !!findInReactTree(item, (x) => hasOnSelected(x, marker));

const asMenuItems = (items: any): any[] | undefined => {
  if (Array.isArray(items)) return items;
  if (!items || typeof items !== "object") return undefined;
  return findInReactTree(
    items,
    (node) => Array.isArray(node) && node.some((item) => containsMenuItem(item, APP_PROPERTIES_ITEM)),
  );
};

// Always add before "Properties..."
const spliceMenuItem = (children: any, appid: number) => {
  const menuItems = asMenuItems(children);
  if (!menuItems) return;
  const propertiesMenuItemIdx = menuItems.findIndex((item) => containsMenuItem(item, APP_PROPERTIES_ITEM));
  if (propertiesMenuItemIdx < 0) return;
  const propertiesMenuItem = menuItems[propertiesMenuItemIdx];
  handleItemDupes(menuItems);
  menuItems.splice(
    menuItems.indexOf(propertiesMenuItem),
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
const isOpeningAppContextMenu = (items: any) => {
  const menuItems = asMenuItems(items);
  if (!menuItems?.length) {
    return false;
  }
  return !!findInReactTree(menuItems, (x) => hasOnSelected(x, "launchSource"));
};

const handleItemDupes = (items: any) => {
  const menuItems = asMenuItems(items);
  if (!menuItems) return;
  for (let i = menuItems.length - 1; i >= 0; i--) {
    if (menuItems[i]?.key === MENU_ITEM_KEY) menuItems.splice(i, 1);
  }
};

const patchMenuItems = (menuItems: any, appid: number) => {
  const items = asMenuItems(menuItems);
  if (!items) return;
  let updatedAppid: number = appid;
  // find the first menu component that has the correct appid, sometimes the one passed is cached from another context menu
  const parentOverview = items.find(
    (x: any) => x?._owner?.pendingProps?.overview?.appid && x._owner.pendingProps.overview.appid !== appid,
  );
  if (parentOverview) {
    updatedAppid = parentOverview._owner.pendingProps.overview.appid;
  }
  if (updatedAppid === appid) {
    const foundApp = findInTree(items, (x) => x?.app?.appid, { walkable: ["props", "children"] });
    if (foundApp) {
      updatedAppid = foundApp.app.appid;
    }
  }
  spliceMenuItem(items, updatedAppid);
};

/** Install lazily: a Steam menu change must not prevent the sidebar loading. */
export default function installGameMenu(): () => void {
  const patches: Patch[] = [];
  const prototypes = new WeakSet<object>();
  const components = new WeakSet<object>();
  let currentAppId = 0;
  const cleanup = () => { for (const patch of patches.splice(0).reverse()) patch.unpatch(); };
  const update = (items: any, appid: number) => {
    if (!isOpeningAppContextMenu(items)) return;
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
