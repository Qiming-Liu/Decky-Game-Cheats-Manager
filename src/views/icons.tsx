import { ReactNode } from "react";

// Outline icons drawn on a 24px grid, sized and coloured by the caller.

interface IconProps { size?: number; color?: string; width?: number }

function icon(paths: ReactNode, defaultWidth = 2, fill?: boolean) {
  return ({ size = 18, color = "currentColor", width = defaultWidth }: IconProps) =>
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" style={{ flex: "0 0 auto" }}
      fill={fill ? color : "none"} stroke={fill ? "none" : color} strokeWidth={width} strokeLinecap="round" strokeLinejoin="round">
      {paths}
    </svg>;
}

/**
 * The L1/R1 bumper glyph in SteamOS's style: a shoulder-shaped plate, rounded on the outer top
 * corner, with the button's name cut out of it so the background shows through.
 */
export function BumperGlyph({ side, size = 20, color = "currentColor" }: { side: "L" | "R"; size?: number; color?: string }) {
  const id = `gcm-bumper-${side}`;
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 32 32" style={{ flex: "0 0 auto" }}>
    <mask id={id}>
      <rect width="32" height="32" fill="#fff" />
      <text x="16" y="23" textAnchor="middle" fontSize="14" fontWeight="700" fontFamily="Motiva Sans, Arial, sans-serif" fill="#000">{side}1</text>
    </mask>
    {/* The mask sits on the group so only the plate is mirrored for R, not the text. */}
    <g mask={`url(#${id})`}>
      <path fill={color} transform={side === "R" ? "matrix(-1 0 0 1 32 0)" : undefined}
        d="M7 2C3.1 2 0 6 0 11v17.5C0 29.4.6 30 1.4 30h29.2c.8 0 1.4-.6 1.4-1.5V3.5C32 2.6 31.4 2 30.6 2z" />
    </g>
  </svg>;
}

export const PlayIcon = icon(<path d="M5 3l14 9-14 9z" />);
export const PlayFilledIcon = icon(<path d="M6 4l13 8-13 8z" />, 0, true);
export const SlidersIcon = icon(<>
  <path d="M4 7h16M4 12h16M4 17h16" />
  <circle cx="9" cy="7" r="2" fill="#0e141b" /><circle cx="15" cy="12" r="2" fill="#0e141b" /><circle cx="8" cy="17" r="2" fill="#0e141b" />
</>);
export const TerminalIcon = icon(<path d="M4 5h16v14H4zM8 10l3 2-3 2M13 14h4" />);
export const SearchIcon = icon(<><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></>, 2.2);
export const FolderIcon = icon(<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" />);
export const CheckCircleIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></>, 2.4);
export const CircleIcon = icon(<circle cx="12" cy="12" r="9" />);
export const WarningIcon = icon(<><path d="M12 3l10 18H2z" /><path d="M12 10v5M12 18v.5" /></>, 2.2);
export const DownloadIcon = icon(<path d="M12 4v12M7 11l5 5 5-5M4 20h16" />, 2.2);
export const BackIcon = icon(<path d="M15 5l-7 7 7 7" />, 2.4);
export const PlusIcon = icon(<path d="M12 5v14M5 12h14" />, 2.6);
export const CheckIcon = icon(<path d="M5 12l5 5 9-10" />, 2.6);
export const CrossIcon = icon(<path d="M6 6l12 12M18 6L6 18" />, 2.6);
export const InfoIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></>);
export const AlertCircleIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M12 7v6M12 16.5v.5" /></>, 2.4);
export const ChevronLeftIcon = icon(<path d="M15 5l-7 7 7 7" />, 2.2);
export const ChevronRightIcon = icon(<path d="M9 5l7 7-7 7" />, 2.2);
export const ChevronDownIcon = icon(<path d="M6 9l6 6 6-6" />, 2.2);
export const StopIcon = icon(<><circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" /></>);
export const TrashIcon = icon(<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />);
export const MoreIcon = icon(<><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></>, 0, true);
export const LinkIcon = icon(<><path d="M10 14a4 4 0 005.66 0l3-3a4 4 0 00-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 00-5.66 0l-3 3a4 4 0 005.66 5.66l1-1" /></>, 2.2);
export const SquareIcon = icon(<rect x="3" y="3" width="18" height="18" rx="4" />);
export const GearIcon = icon(<><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" /><circle cx="12" cy="12" r="3" /></>);
export const ChevronUpIcon = icon(<path d="M6 15l6-6 6 6" />, 2.4);
export const WindowIcon = icon(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></>);
