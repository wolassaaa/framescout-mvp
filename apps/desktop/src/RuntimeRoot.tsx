import { useCallback, useEffect, useState } from "react";
import { RefreshCw, TerminalSquare } from "lucide-react";
import { App } from "./App";
import {
  createRuntimeProjectClient,
  type ConnectedRuntimeProjectClient,
  type RuntimeProjectClient
} from "./features/project/runtimeProjectClient";

type RuntimeFactory = () => Promise<RuntimeProjectClient>;

function defaultRuntimeFactory() {
  return createRuntimeProjectClient({
    storage: window.localStorage,
    allowBrowserFixture: import.meta.env.VITE_FRAMESCOUT_DEMO_MODE === "true"
  });
}

export function RuntimeRoot({ createClient = defaultRuntimeFactory }: { createClient?: RuntimeFactory }) {
  const [runtime, setRuntime] = useState<RuntimeProjectClient | null>(null);
  const [busy, setBusy] = useState(true);

  const connect = useCallback(async () => {
    setBusy(true);
    try {
      setRuntime(await createClient());
    } finally {
      setBusy(false);
    }
  }, [createClient]);

  useEffect(() => {
    void connect();
  }, [connect]);

  if (busy && !runtime) {
    return <main className="service-gate" aria-live="polite"><p>正在连接 FrameScout 本地服务...</p></main>;
  }

  if (!runtime || runtime.kind === "offline") {
    return (
      <main className="service-gate">
        <section className="service-recovery" aria-labelledby="service-offline-title">
          <TerminalSquare size={28} aria-hidden="true" />
          <p className="eyebrow">FrameScout Local Service</p>
          <h1 id="service-offline-title">本地服务未连接</h1>
          <p>请保留 FrameScout 终端窗口运行。服务恢复后可直接重新连接，不会载入演示项目。</p>
          <p className="service-recovery-en">Local service is offline. Keep the FrameScout terminal open, then reconnect.</p>
          {runtime?.apiUrl && <code>{runtime.apiUrl}</code>}
          {runtime?.message && <details><summary>诊断信息 / Diagnostics</summary><pre>{runtime.message}</pre></details>}
          <button className="primary-action" type="button" onClick={() => void connect()} disabled={busy}>
            <RefreshCw size={16} aria-hidden="true" />
            {busy ? "正在连接" : "重新连接"}
          </button>
        </section>
      </main>
    );
  }

  return <App runtimeProjectClient={runtime as ConnectedRuntimeProjectClient} />;
}
