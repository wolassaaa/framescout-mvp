import { Star } from "lucide-react";
import type { ReviewAsset } from "@framescout/contracts";
import { aiReviewStatus } from "./aiReview";
import { type UiLanguage, uiCopy } from "../../i18n/uiCopy";

export function AiReviewMark({ asset, language }: { asset: ReviewAsset; language: UiLanguage }) {
  const status = aiReviewStatus(asset);
  if (status === "pending") return null;
  const label = uiCopy[language].aiMark[status];
  return <span className={`ai-review-mark ${status}`} role="img" aria-label={label} title={label}><Star size={14} fill="currentColor" aria-hidden="true" /></span>;
}
