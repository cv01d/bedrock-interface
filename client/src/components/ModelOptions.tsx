import type { ModelInfo } from "@chat/shared";

// Renders <option>s grouped by region. Cross-region inference profiles route
// outside the home region and fail with "Operation not allowed" on sandboxed
// accounts, so they're grouped separately and labelled as such.
export function ModelOptions({ models }: { models: ModelInfo[] }) {
  const inRegion = models.filter((m) => !m.crossRegion);
  const crossRegion = models.filter((m) => m.crossRegion);

  return (
    <>
      {inRegion.length > 0 && (
        <optgroup label="In-region (on-demand)">
          {inRegion.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </optgroup>
      )}
      {crossRegion.length > 0 && (
        <optgroup label="Cross-region — may be blocked on restricted accounts">
          {crossRegion.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </optgroup>
      )}
    </>
  );
}
