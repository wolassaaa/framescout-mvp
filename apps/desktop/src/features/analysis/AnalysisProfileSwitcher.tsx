import { useEffect, useState } from "react";
import { AlertTriangle, Check, ChevronDown, Cloud, Cpu, Gauge, MonitorCog } from "lucide-react";
import type { AnalysisConfigResponse, AnalysisConfigSetRequest, AnalysisExecutionMode, AnalysisProfile, AnalysisProfileId } from "@framescout/contracts";
import { type UiLanguage, uiCopy } from "../../i18n/uiCopy";

function profileLabel(profileId: AnalysisProfileId, language: UiLanguage) {
  const text = uiCopy[language].profile;
  if (profileId === "local-gpu-quality") return { name: text.localGpuQuality, detail: text.localGpuQualityDetail };
  if (profileId === "local-gpu-fast") return { name: text.localGpuFast, detail: text.localGpuFastDetail };
  if (profileId === "local-cpu-fast") return { name: text.localCpuFast, detail: text.localCpuFastDetail };
  if (profileId === "qwen-cloud") return { name: text.qwenCloud, detail: text.qwenCloudDetail };
  return { name: text.customCloud, detail: text.customCloudDetail };
}

function ProfileIcon({ profile }: { profile: AnalysisProfile }) {
  if (profile.backend === "cloud") return <Cloud size={16} />;
  if (profile.backend === "cpu") return <Cpu size={16} />;
  return profile.id === "local-gpu-fast" ? <Gauge size={16} /> : <MonitorCog size={16} />;
}

export function AnalysisProfileSwitcher({
  language,
  config,
  busy,
  onSelect
}: {
  language: UiLanguage;
  config: AnalysisConfigResponse | null;
  busy: boolean;
  onSelect: (profileId: AnalysisProfileId, options?: Omit<AnalysisConfigSetRequest, "profileId">) => Promise<void>;
}) {
  const text = uiCopy[language].profile;
  const [open, setOpen] = useState(false);
  const custom = config?.profiles.find((profile) => profile.id === "custom-cloud");
  const [endpoint, setEndpoint] = useState(custom?.endpoint ?? "");
  const [model, setModel] = useState(custom?.model ?? "");
  const [executionMode, setExecutionMode] = useState<AnalysisExecutionMode>(config?.executionMode === "hybrid" ? "cloud" : config?.executionMode ?? "local");
  const [cloudBudgetCents, setCloudBudgetCents] = useState(config?.cloudBudgetCents ?? 0);
  const [cloudConcurrency, setCloudConcurrency] = useState(config?.cloudConcurrency ?? 2);
  useEffect(() => {
    setEndpoint(custom?.endpoint ?? "");
    setModel(custom?.model ?? "");
    setExecutionMode(config?.executionMode === "hybrid" ? "cloud" : config?.executionMode ?? "local");
    setCloudBudgetCents(config?.cloudBudgetCents ?? 0);
    setCloudConcurrency(config?.cloudConcurrency ?? 2);
  }, [config?.cloudBudgetCents, config?.cloudConcurrency, config?.executionMode, custom?.endpoint, custom?.model]);

  const active = config?.profiles.find((profile) => profile.id === config.activeProfileId);
  const activeMatchesMode = active
    ? executionMode === "local" ? active.provider === "local" : active.provider !== "local"
    : false;
  const activeLabel = active ? profileLabel(active.id, language).name : text.analysisLane;
  const routingOptions = () => ({ executionMode, cloudBudgetCents, cloudConcurrency });
  const selectAndClose = async (profileId: AnalysisProfileId, options?: Omit<AnalysisConfigSetRequest, "profileId">) => {
    await onSelect(profileId, { ...routingOptions(), ...options });
    setOpen(false);
  };
  const modeOptions: Array<{ id: AnalysisExecutionMode; label: string }> = [
    { id: "cloud", label: text.cloudFirst },
    { id: "local", label: text.localFirst }
  ];

  return (
    <div className="analysis-profile-switcher">
      <button
        className={`analysis-profile-trigger ${active?.backend === "cloud" ? "cloud" : ""}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        title={text.switch}
      >
        {active ? <ProfileIcon profile={active} /> : <MonitorCog size={16} />}
        <span><small>{text.lane}</small>{activeLabel}</span>
        <i className={`profile-status ${active?.available ? "ready" : "offline"}`} aria-hidden="true" />
        <ChevronDown size={14} />
      </button>
      {open && (
        <section className="analysis-profile-panel" role="dialog" aria-label={text.chooseLane}>
          <header>
            <div>
              <strong>{text.analysisLane}</strong>
              <span>{text.applies}</span>
            </div>
            <span className="proxy-rule">RAW {text.rawNeverUploads}</span>
          </header>
          <div className="analysis-routing-settings">
            <div className="execution-mode-control" role="radiogroup" aria-label={text.executionMode}>
              {modeOptions.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  role="radio"
                  aria-checked={executionMode === mode.id}
                  className={executionMode === mode.id ? "active" : ""}
                  onClick={() => setExecutionMode(mode.id)}
                >
                  {mode.label}
                </button>
              ))}
            </div>
            <p>{text.proxyOnlyPrivacy}</p>
            <div className="cloud-limit-fields">
              <label>
                <span>{text.cloudBudget}</span>
                <input type="number" min="0" max="100000" step="100" value={cloudBudgetCents} onChange={(event) => setCloudBudgetCents(Number(event.target.value))} />
              </label>
              <label>
                <span>{text.cloudConcurrency}</span>
                <select value={cloudConcurrency} onChange={(event) => setCloudConcurrency(Number(event.target.value))}>
                  {[1, 2, 3, 4].map((value) => <option key={value} value={value}>{value}</option>)}
                </select>
              </label>
              <button type="button" disabled={busy || !activeMatchesMode} onClick={() => active && void selectAndClose(active.id)}>{text.saveRouting}</button>
            </div>
            <small>{text.budgetEstimate}</small>
          </div>
          <div className="profile-group-label">{text.local}</div>
          {config?.profiles.filter((profile) => profile.provider === "local").map((profile) => (
            <ProfileRow key={profile.id} profile={profile} active={config.activeProfileId === profile.id} language={language} busy={busy} onSelect={(profileId) => selectAndClose(profileId, { executionMode: "local" })} />
          ))}
          <div className="profile-group-label cloud-label">{text.cloud}<span>{text.proxyLeaves}</span></div>
          {config?.profiles.filter((profile) => profile.provider !== "local").map((profile) => (
            <ProfileRow key={profile.id} profile={profile} active={config.activeProfileId === profile.id} language={language} busy={busy} onSelect={(profileId) => selectAndClose(profileId, { executionMode: executionMode === "local" ? "cloud" : executionMode })} />
          ))}
          <div className="custom-api-fields">
            <label><span>{text.endpoint}</span><input value={endpoint} onChange={(event) => setEndpoint(event.target.value)} placeholder="https://.../v1/chat/completions" /></label>
            <label><span>{text.modelName}</span><input value={model} onChange={(event) => setModel(event.target.value)} placeholder="vision-model" /></label>
            <button type="button" disabled={busy || !endpoint || !model} onClick={() => void selectAndClose("custom-cloud", { endpoint, model, executionMode: executionMode === "local" ? "cloud" : executionMode })}>{text.saveSwitch}</button>
          </div>
          <footer><AlertTriangle size={14} /><span>{text.keys}</span></footer>
        </section>
      )}
    </div>
  );
}

function ProfileRow({ profile, active, language, busy, onSelect }: { profile: AnalysisProfile; active: boolean; language: UiLanguage; busy: boolean; onSelect: (profileId: AnalysisProfileId) => Promise<void> }) {
  const copy = profileLabel(profile.id, language);
  return (
    <button className={`profile-row ${active ? "active" : ""}`} type="button" disabled={busy || !profile.available} onClick={() => void onSelect(profile.id)}>
      <ProfileIcon profile={profile} />
      <span className="profile-row-copy"><strong>{copy.name}</strong><small>{copy.detail}</small></span>
      <span className="profile-model">{profile.model}</span>
      {active ? <Check size={16} /> : <i className={`profile-status ${profile.available ? "ready" : "offline"}`} />}
    </button>
  );
}
