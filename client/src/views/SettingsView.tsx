import { useEffect, useState } from "react";
import type { SettingsUpdate } from "@chat/shared";
import { useStore } from "../state/store";
import { api } from "../lib/api";
import { ModelOptions } from "../components/ModelOptions";

const COMMON_TZ = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "Europe/London",
  "Europe/Berlin",
  "Asia/Tokyo",
  "Asia/Kolkata",
  "Australia/Sydney",
];

export function SettingsView() {
  const { settings, models, loadSettings, loadModels } = useStore();

  const [timezone, setTimezone] = useState("UTC");
  const [temperature, setTemperature] = useState(0.7);
  const [contextSize, setContextSize] = useState(20);
  const [awsRegion, setAwsRegion] = useState("us-east-1");
  const [summarizerModel, setSummarizerModel] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [banner, setBanner] = useState<{ ok: boolean; text: string } | null>(
    null
  );

  useEffect(() => {
    if (settings) {
      setTimezone(settings.timezone);
      setTemperature(settings.temperature);
      setContextSize(settings.contextSize);
      setAwsRegion(settings.awsRegion);
      setSummarizerModel(settings.defaultSummarizerModelId);
    }
  }, [settings]);

  const save = async () => {
    setSaving(true);
    setBanner(null);
    const patch: SettingsUpdate = {
      timezone,
      temperature,
      contextSize,
      awsRegion,
      defaultSummarizerModelId: summarizerModel,
    };
    if (accessKey.trim()) patch.awsAccessKeyId = accessKey.trim();
    if (secretKey.trim()) patch.awsSecretAccessKey = secretKey.trim();

    try {
      const { validation } = await api.updateSettings(patch);
      setAccessKey("");
      setSecretKey("");
      await loadSettings();
      await loadModels();
      if (validation.ok) {
        setBanner({
          ok: true,
          text: `Saved. Bedrock reachable — ${
            validation.modelCount ?? 0
          } models available.`,
        });
      } else {
        setBanner({
          ok: false,
          text: `Saved, but Bedrock validation failed: ${validation.error}`,
        });
      }
    } catch (err) {
      setBanner({
        ok: false,
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="layout" style={{ gridTemplateColumns: "1fr" }}>
      <section className="main">
        <div className="panel">
          <h2>Settings</h2>
          {banner && (
            <div className={`banner ${banner.ok ? "ok" : "error"}`}>
              {banner.text}
            </div>
          )}

          <div className="field">
            <label>Timezone</label>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {COMMON_TZ.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
              {!COMMON_TZ.includes(timezone) && (
                <option value={timezone}>{timezone}</option>
              )}
            </select>
          </div>

          <div className="field">
            <label>Temperature</label>
            <div className="row">
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
              />
              <span className="range-val">{temperature.toFixed(2)}</span>
            </div>
          </div>

          <div className="field">
            <label>
              Context size — number of recent messages sent with each request
            </label>
            <div className="row">
              <input
                type="range"
                min={1}
                max={100}
                step={1}
                value={contextSize}
                onChange={(e) => setContextSize(Number(e.target.value))}
              />
              <span className="range-val">{contextSize}</span>
            </div>
          </div>

          <h3>Amazon Bedrock</h3>
          <div className="field">
            <label>AWS region</label>
            <input
              value={awsRegion}
              onChange={(e) => setAwsRegion(e.target.value)}
              placeholder="us-east-1"
            />
          </div>

          <div className="field">
            <label>
              AWS access key ID{" "}
              {settings?.hasAwsAccessKeyId && (
                <span className="muted">(saved — leave blank to keep)</span>
              )}
            </label>
            <input
              type="password"
              autoComplete="off"
              value={accessKey}
              onChange={(e) => setAccessKey(e.target.value)}
              placeholder={settings?.hasAwsAccessKeyId ? "••••••••" : "AKIA…"}
            />
          </div>

          <div className="field">
            <label>
              AWS secret access key{" "}
              {settings?.hasAwsSecretAccessKey && (
                <span className="muted">(saved — leave blank to keep)</span>
              )}
            </label>
            <input
              type="password"
              autoComplete="off"
              value={secretKey}
              onChange={(e) => setSecretKey(e.target.value)}
              placeholder={settings?.hasAwsSecretAccessKey ? "••••••••" : ""}
            />
          </div>

          <div className="field">
            <label>Summarizer model — small/cheap model for chat summaries</label>
            <select
              value={summarizerModel}
              onChange={(e) => setSummarizerModel(e.target.value)}
            >
              <option value="">— select —</option>
              <ModelOptions models={models} />
            </select>
            {models.length === 0 && (
              <p className="muted" style={{ marginTop: 6 }}>
                Save valid AWS credentials to load the model list.
              </p>
            )}
          </div>

          <button className="primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
          <p className="muted" style={{ marginTop: 14 }}>
            Credentials are encrypted at rest with your MASTER_KEY and never
            returned to the browser.
          </p>
        </div>
      </section>
    </div>
  );
}
