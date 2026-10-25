import type { Dispatch } from "react";
import { CheckCheck, Eraser } from "lucide-react";
import { type UiLanguage, uiCopy } from "../../i18n/uiCopy";
import type { ReviewAction } from "./reviewState";

export type { UiLanguage } from "../../i18n/uiCopy";
export type ReviewDispatch = Dispatch<ReviewAction>;

export function SelectionToolbar({ language, sessionIds, selectedIds, dispatch }: {
  language: UiLanguage;
  sessionIds: string[];
  selectedIds: string[];
  dispatch: ReviewDispatch;
}) {
  const text = uiCopy[language].selection;
  const allSessionMarked = sessionIds.length > 0 && sessionIds.every((assetId) => selectedIds.includes(assetId));

  return (
    <section className="selection-toolbar" aria-label={text.group}>
      <span className="selection-toolbar-label">{text.group}</span>
      <button type="button" className="selection-toolbar-command primary-selection-command" onClick={() => dispatch({ type: "selectAssets", assetIds: sessionIds })} disabled={sessionIds.length === 0 || allSessionMarked}>
        <CheckCheck size={15} aria-hidden="true" /><span>{text.selectAll}</span>
      </button>
      <button type="button" className="selection-toolbar-command" onClick={() => dispatch({ type: "clearGridSelection" })} disabled={selectedIds.length === 0}>
        <Eraser size={14} aria-hidden="true" /><span>{text.clearCurrentResult}</span>
      </button>
      <output className="selection-toolbar-count" aria-live="polite">{selectedIds.length} {text.marked}</output>
    </section>
  );
}
