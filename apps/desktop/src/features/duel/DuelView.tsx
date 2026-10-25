import { type Dispatch, useEffect, useMemo, useState } from "react";
import type { GroupOpenResponse, HumanDisposition } from "@framescout/contracts";
import { ArrowLeft, ArrowRight, Pin, Swords, X } from "lucide-react";
import type { ReviewAction } from "../review/reviewState";
import { formatCopy, type UiLanguage, uiCopy } from "../../i18n/uiCopy";

function focusScore(asset: GroupOpenResponse["assets"][number]): number {
  const signal = asset.evidence.find((item) => item.label.toLowerCase().includes("focus"));
  return signal?.confidence ?? (asset.aiDisposition === "keep" ? 0.75 : asset.aiDisposition === "review" ? 0.5 : 0.2);
}

export function DuelView({
  language,
  group,
  dispatch,
  onExit
}: {
  language: UiLanguage;
  group: GroupOpenResponse;
  dispatch: Dispatch<ReviewAction>;
  onExit: () => void;
}) {
  const text = uiCopy[language].duel;
  const reviewText = uiCopy[language].review;
  const [leftId, setLeftId] = useState(group.assets[group.focusIndex]?.id ?? group.assets[0]?.id);
  const [rightId, setRightId] = useState(group.assets.find((asset) => asset.id !== leftId)?.id ?? leftId);
  const left = useMemo(() => group.assets.find((asset) => asset.id === leftId) ?? group.assets[0], [group.assets, leftId]);
  const right = useMemo(() => group.assets.find((asset) => asset.id === rightId) ?? group.assets[1] ?? left, [group.assets, rightId, left]);

  const choose = (assetId: string) => dispatch({ type: "setDecisionFor", assetId, disposition: "select" });
  const pinBoth = () => {
    if (!left || !right) return;
    dispatch({ type: "setDecisionFor", assetId: left.id, disposition: "candidate" });
    if (right.id !== left.id) dispatch({ type: "setDecisionFor", assetId: right.id, disposition: "candidate" });
  };
  const rejectWeaker = () => {
    if (!left || !right) return;
    dispatch({ type: "setDecisionFor", assetId: focusScore(left) <= focusScore(right) ? left.id : right.id, disposition: "reject" });
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
      if (event.key === "ArrowLeft" && left) choose(left.id);
      if (event.key === "ArrowRight" && right) choose(right.id);
      if (event.key.toLowerCase() === "p") pinBoth();
      if (event.key.toLowerCase() === "x") rejectWeaker();
      if (event.key.toLowerCase() === "z") dispatch({ type: event.shiftKey ? "redo" : "undo" });
      if (event.key.toLowerCase() === "d" || event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [left, right]);

  if (!left || !right) {
    return <section className="duel-view duel-empty"><strong>{text.empty}</strong><button onClick={onExit}>{text.back}</button></section>;
  }

  const sharperSide = focusScore(left) >= focusScore(right) ? text.left : text.right;
  return (
    <section className="duel-view" aria-label={text.region}>
      <header className="duel-header">
        <div><Swords size={17} /><strong>{text.region}</strong><span>{group.groupId} / {group.assets.length} {text.frames}</span></div>
        <button className="duel-exit" onClick={onExit}>{text.back}</button>
      </header>
      <p className="duel-evidence">{formatCopy(text.evidence, { side: sharperSide })}</p>
      <div className="duel-stage">
        {([left, right] as const).map((asset, index) => (
          <article className="duel-frame" key={asset.id}>
            <img src={asset.previewUrl} alt="" />
            <div className="duel-frame-meta"><strong>{asset.fileName}</strong><span>{reviewText.human[asset.humanDisposition]}</span></div>
            <button className="duel-choice" onClick={() => choose(asset.id)}>
              {index === 0 ? <ArrowLeft size={16} /> : <ArrowRight size={16} />} {formatCopy(text.choose, { side: index === 0 ? text.left : text.right })}
            </button>
          </article>
        ))}
      </div>
      <div className="duel-actions" aria-label={text.actions}>
        <button onClick={pinBoth}><Pin size={15} /> {text.pinBoth}</button>
        <button onClick={rejectWeaker}><X size={15} /> {text.rejectWeaker}</button>
      </div>
      <div className="duel-stack" aria-label={text.burstFrames}>
        {group.assets.map((asset) => (
          <button
            className={asset.id === left.id || asset.id === right.id ? "active" : undefined}
            key={asset.id}
            onClick={() => (asset.id !== left.id ? setRightId(asset.id) : setLeftId(asset.id))}
          >
            <img src={asset.previewUrl} alt="" />
            <span>{asset.fileName}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
