export function GroupBadge({ color, name }: { color?: string; name: string }) {
  const displayName = name || "未分组";
  return (
    <span className="group-badge" title={displayName}>
      <i style={{ background: color || "#8f8173" }} />
      <span>{displayName}</span>
    </span>
  );
}
