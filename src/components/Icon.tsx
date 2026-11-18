// Small stroke icon set drawn for OpenPDF (24x24 grid).
const PATHS = {
  note: "M4 3h16v12l-6 6H4zM14 21v-6h6M8 7h8M8 11h5",
  hand: "M7 12V6a1.5 1.5 0 0 1 3 0v5-7a1.5 1.5 0 0 1 3 0v7-6a1.5 1.5 0 0 1 3 0v6-4a1.5 1.5 0 0 1 3 0v7c0 4-2 7-6 7h-2c-2 0-3-1-4-3l-4-5a1.5 1.5 0 0 1 2-2z",
  menu: "M4 7h16M4 12h16M4 17h16",
  open: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  minus: "M6 12h12",
  plus: "M12 6v12M6 12h12",
  fitPage: "M7 3h10a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1zM12 7v10M9.5 9.5 12 7l2.5 2.5M9.5 14.5 12 17l2.5-2.5",
  fitWidth: "M3 6h18v12H3zM7 12h10M9.5 9.5 7 12l2.5 2.5M14.5 9.5 17 12l-2.5 2.5",
  rotate: "M20 5v5h-5M19.4 10A8 8 0 1 0 20 14",
  draw: "M4 20l1-4L16.5 4.5a2.1 2.1 0 0 1 3 3L8 19zM14.5 6.5l3 3",
  highlight: "M9 14l-2 5h5l1-2M9 14l7.5-9.5 4 3.2L13 17zM3 21h18",
  text: "M5 6V4h14v2M12 4v16M9 20h6",
  undo: "M9 5 4 10l5 5M4 10h10.5a4.5 4.5 0 0 1 0 9H11",
  redo: "M15 5l5 5-5 5M20 10H9.5a4.5 4.5 0 0 0 0 9H13",
  trash: "M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 11v6M14 11v6",
  download: "M12 4v11M7.5 11 12 15.5 16.5 11M5 20h14",
  print: "M7 9V4h10v5M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7z",
  more: "M12 5.5v.01M12 12v.01M12 18.5v.01",
  search: "M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM15.5 15.5 20 20",
  up: "M6 15l6-6 6 6",
  down: "M6 9l6 6 6-6",
  close: "M6 6l12 12M18 6 6 18",
  check: "M5 12.5l4.5 4.5L19 7.5",
  twoPages: "M4 5h7v14H4zM13 5h7v14h-7z",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5v.01",
  present: "M3 5h18v11H3zM12 16v4M8 20h8",
  comment: "M4 5h16v11H9l-5 4z",
  theme: "M12 3a9 9 0 1 0 0 18zM12 3a9 9 0 0 1 0 18",
  globe: "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18",
  thumbnails: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  outline: "M4 6h.01M8 6h12M4 12h.01M8 12h12M4 18h.01M8 18h12",
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "more" ? 2.6 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

interface IconButtonProps {
  icon: IconName;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
  active?: boolean;
  flipInRtl?: boolean;
}

export function IconButton({ icon, label, onClick, disabled, active, flipInRtl }: IconButtonProps) {
  return (
    <button
      type="button"
      className={"icon-button" + (active ? " is-active" : "") + (flipInRtl ? " flip-rtl" : "")}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
    >
      <Icon name={icon} />
    </button>
  );
}
