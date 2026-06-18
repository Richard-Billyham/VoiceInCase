import type { StatusTone } from "../../utils/format";

interface StatusPillProps {
  value: string;
  tone?: StatusTone;
}

export function StatusPill({ value, tone = "neutral" }: StatusPillProps) {
  return <span className={`status-pill ${tone}`}>{value}</span>;
}
