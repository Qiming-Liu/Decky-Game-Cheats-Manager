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
export const LockIcon = icon(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 018 0v4" /></>);
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
export const CopyIcon = icon(<><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 012-2h9" /></>);
export const GearIcon = icon(<><circle cx="12" cy="12" r="3" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></>);
export const ChevronUpIcon = icon(<path d="M6 15l6-6 6 6" />, 2.4);
export const WindowIcon = icon(<><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18" /></>);
