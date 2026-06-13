interface StatusPillProps {
  value: string;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}

export function StatusPill({ value, tone = "neutral" }: StatusPillProps) {
  return <span className={`status-pill ${tone}`}>{value}</span>;
}
