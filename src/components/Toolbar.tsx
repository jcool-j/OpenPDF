import { useEffect, useRef, useState } from "react";
import { useI18n, type ThemePreference } from "../i18n";
import type { EditorTool, ViewerController, ViewerState } from "../services/pdf/viewerController";
import { Icon, IconButton, type IconName } from "./Icon";

import type { PointerMode } from "../services/pdf/pointer";

interface ToolbarProps {
  noteTool: boolean;
  commentsOpen: boolean;
  onComments(): void;
  onNoteTool(): void;
  pointerMode: PointerMode;
  onPointerModeChange(mode: PointerMode): void;
  controller: ViewerController;
  state: ViewerState;
  fileName: string;
  sidebarOpen: boolean;
  annotationsVisible: boolean;
  theme: ThemePreference;
  onThemeChange(theme: ThemePreference): void;
  onToggleSidebar(): void;
  onOpen(): void;
  onSave(): void;
  onPrint(): void;
  onFind(): void;
  onProperties(): void;
  onPresent(): void;
  onToggleAnnotations(): void;
  onToggleLanguage(): void;
}

/** A number field that only commits on Enter or blur, like Chrome's page and zoom boxes. */
function CommitInput(props: {
  value: string;
  label: string;
  className: string;
  disabled?: boolean;
  onCommit(value: string): void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      className={props.className}
      type="text"
      inputMode="numeric"
      dir="ltr"
      aria-label={props.label}
      title={props.label}
      disabled={props.disabled}
      value={draft ?? props.value}
      onFocus={(event) => event.currentTarget.select()}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== null && draft !== props.value) props.onCommit(draft);
        setDraft(null);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
        if (event.key === "Escape") {
          setDraft(null);
          requestAnimationFrame(() => (document.activeElement as HTMLElement | null)?.blur());
        }
      }}
    />
  );
}

function MenuItem(props: {
  icon: IconName;
  label: string;
  shortcut?: string;
  checked?: boolean;
  disabled?: boolean;
  onSelect(): void;
}) {
  const isToggle = props.checked !== undefined;
  return (
    <button
      type="button"
      className="menu-item"
      role={isToggle ? "menuitemcheckbox" : "menuitem"}
      aria-checked={isToggle ? props.checked : undefined}
      disabled={props.disabled}
      onClick={props.onSelect}
    >
      <Icon name={props.icon} size={18} />
      <span className="menu-label">{props.label}</span>
      {props.shortcut && <kbd dir="ltr">{props.shortcut}</kbd>}
      {isToggle && <span className="menu-check">{props.checked && <Icon name="check" size={16} />}</span>}
    </button>
  );
}

export function Toolbar(props: ToolbarProps) {
  const { controller, state } = props;
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const has = state.hasDocument;

  useEffect(() => {
    if (!menuOpen) return;
    const onPointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setMenuOpen(false);
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const select = (action: () => void) => () => {
    setMenuOpen(false);
    action();
  };
  const toggleTool = (tool: EditorTool) => controller.setTool(state.tool === tool ? "none" : tool);
  const fitsPage = state.scaleValue === "page-fit";

  return (
    <header className="toolbar" role="toolbar" aria-label="OpenPDF">
      <div className="toolbar-start">
        <IconButton
          icon="menu"
          label={t("toggleSidebar")}
          onClick={props.onToggleSidebar}
          disabled={!has}
          active={has && props.sidebarOpen}
        />
        <span className="file-name" title={props.fileName} dir="auto">
          {props.fileName}
        </span>
      </div>

      <div className="toolbar-center">
        <div className="page-box">
          <CommitInput
            className="page-input"
            label={t("page")}
            disabled={!has}
            value={has ? String(state.page) : ""}
            onCommit={(value) => {
              const page = parseInt(value, 10);
              if (Number.isFinite(page)) controller.goToPage(page);
            }}
          />
          <span className="page-count" dir="ltr">
            / {has ? state.pageCount : "–"}
          </span>
        </div>
        <span className="separator" />
        <IconButton icon="minus" label={t("zoomOut")} disabled={!has} onClick={() => controller.zoomOut()} />
        <CommitInput
          className="zoom-input"
          label={t("zoomLevel")}
          disabled={!has}
          value={has ? `${Math.round(state.scale * 100)}%` : ""}
          onCommit={(value) => controller.setScalePercent(parseFloat(value.replace("%", "")))}
        />
        <IconButton icon="plus" label={t("zoomIn")} disabled={!has} onClick={() => controller.zoomIn()} />
        <span className="separator" />
        <IconButton
          icon={fitsPage ? "fitWidth" : "fitPage"}
          label={fitsPage ? t("fitToWidth") : t("fitToPage")}
          disabled={!has}
          onClick={() => controller.setFit(fitsPage ? "page-width" : "page-fit")}
        />
        <IconButton icon="rotate" label={t("rotateCw")} disabled={!has} onClick={() => controller.rotate(90)} />
        <span className="separator" />
        <IconButton
          icon="draw"
          label={t("draw")}
          disabled={!has}
          active={state.tool === "ink"}
          onClick={() => toggleTool("ink")}
        />
        <IconButton
          icon="highlight"
          label={t("highlight")}
          disabled={!has}
          active={state.tool === "highlight"}
          onClick={() => toggleTool("highlight")}
        />
        <IconButton
          icon="text"
          label={t("addText")}
          disabled={!has}
          active={state.tool === "text"}
          onClick={() => toggleTool("text")}
        />
      </div>

      <div className="toolbar-end">
        <IconButton icon="note" label={t("stickyNote")} disabled={!has || !state.notesReady} active={props.noteTool && state.tool === "none"} onClick={props.onNoteTool} />
        <IconButton icon="comment" label={t("comments")} disabled={!has || !state.notesReady} active={props.commentsOpen} onClick={props.onComments} />
        <IconButton icon="hand" label={t("handTool")} disabled={!has}
          active={props.pointerMode === "hand" && state.tool === "none"}
          onClick={() => props.onPointerModeChange(props.pointerMode === "hand" ? "select" : "hand")} />
        <IconButton icon="search" label={`${t("find")} (Ctrl+F)`} disabled={!has} onClick={props.onFind} />
        <IconButton icon="download" label={`${t("download")} (Ctrl+S)`} disabled={!has} onClick={props.onSave} />
        <IconButton icon="print" label={`${t("print")} (Ctrl+P)`} disabled={!has} onClick={props.onPrint} />
        <div className="menu-anchor" ref={menuRef}>
          <IconButton icon="more" label={t("more")} active={menuOpen} onClick={() => setMenuOpen((open) => !open)} />
          {menuOpen && (
            <div className="menu" role="menu">
              <MenuItem icon="open" label={t("openFile")} shortcut="Ctrl+O" onSelect={select(props.onOpen)} />
              <div className="menu-divider" />
              <MenuItem
                icon="twoPages"
                label={t("twoPageView")}
                checked={state.twoPages}
                disabled={!has}
                onSelect={select(() => controller.setTwoPages(!state.twoPages))}
              />
              <MenuItem
                icon="comment"
                label={t("showAnnotations")}
                checked={props.annotationsVisible}
                disabled={!has}
                onSelect={select(props.onToggleAnnotations)}
              />
              <MenuItem
                icon="rotate"
                label={t("rotateCcw")}
                disabled={!has}
                onSelect={select(() => controller.rotate(-90))}
              />
              <MenuItem
                icon="fitWidth"
                label={t("actualSize")}
                disabled={!has}
                onSelect={select(() => controller.setFit("page-actual"))}
              />
              <div className="menu-divider" />
              <MenuItem icon="present" label={t("present")} shortcut="F5" disabled={!has} onSelect={select(props.onPresent)} />
              <MenuItem
                icon="info"
                label={t("documentProperties")}
                disabled={!has}
                onSelect={select(props.onProperties)}
              />
              <div className="menu-divider" />
              <div className="menu-row">
                <Icon name="theme" size={18} />
                <span className="menu-label">{t("theme")}</span>
                <div className="segmented" role="radiogroup" aria-label={t("theme")}>
                  {(["system", "light", "dark"] as const).map((value) => (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={props.theme === value}
                      onClick={() => props.onThemeChange(value)}
                    >
                      {t(value === "system" ? "themeSystem" : value === "light" ? "themeLight" : "themeDark")}
                    </button>
                  ))}
                </div>
              </div>
              <MenuItem icon="globe" label={t("language")} onSelect={select(props.onToggleLanguage)} />
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
