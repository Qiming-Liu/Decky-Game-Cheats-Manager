export const GAME_PAGE_ROUTE = "/game-cheats-manager/:appid";

export const gamePageRoute = (appid: number | string) => `/game-cheats-manager/${appid}`;

// routerHook passes react-router v5-style props, but the exact shape isn't
// part of @decky/ui's stable public types, so the appid is read straight out
// of the URL instead of trusting a particular prop shape across versions.
export function getAppIdFromLocation(): string | null {
  const match = window.location.pathname.match(/\/game-cheats-manager\/(\d+)/);
  return match ? match[1] : null;
}
