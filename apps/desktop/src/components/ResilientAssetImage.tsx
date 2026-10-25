import { useEffect, useRef, useState } from "react";
import type { ReviewAsset } from "@framescout/contracts";
import type { UiLanguage } from "../i18n/uiCopy";

interface ResilientAssetImageProps {
  src: string;
  alt: string;
  previewState?: ReviewAsset["previewState"];
  language: UiLanguage;
  className?: string;
  eager?: boolean;
}

type LoadState = "loading" | "ready" | "retrying" | "failed";

function retryUrl(src: string, attempt: number): string {
  return `${src}${src.includes("?") ? "&" : "?"}fs_retry=${attempt}`;
}

export function ResilientAssetImage({
  src,
  alt,
  previewState,
  language,
  className,
  eager = false
}: ResilientAssetImageProps) {
  const [attempt, setAttempt] = useState(0);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const retryTimer = useRef<number | null>(null);
  const text = language === "zh"
    ? { generating: "缩略图生成中", retrying: "正在重试", failed: "缩略图失败", relink: "需要重新关联" }
    : { generating: "Generating preview", retrying: "Retrying", failed: "Preview failed", relink: "Relink required" };

  useEffect(() => {
    setAttempt(0);
    setLoadState("loading");
    return () => {
      if (retryTimer.current !== null) window.clearTimeout(retryTimer.current);
    };
  }, [src]);

  const statusText = previewState === "needs-relink"
    ? text.relink
    : loadState === "failed"
      ? text.failed
      : loadState === "retrying"
        ? text.retrying
        : previewState === "pending" && loadState !== "ready"
          ? text.generating
          : null;

  return (
    <>
      <img
        className={className}
        loading={eager ? "eager" : "lazy"}
        src={attempt === 0 ? src : retryUrl(src, attempt)}
        alt={alt}
        onLoad={() => setLoadState("ready")}
        onError={() => {
          if (attempt >= 2) {
            setLoadState("failed");
            return;
          }
          setLoadState("retrying");
          retryTimer.current = window.setTimeout(() => setAttempt((current) => current + 1), 300 * (attempt + 1));
        }}
      />
      {statusText && <span className={`preview-load-status ${loadState}`} role="status">{statusText}</span>}
    </>
  );
}
