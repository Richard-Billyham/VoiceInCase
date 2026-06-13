import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { QuickCopySection } from "./quickSubmitText";

interface QuickCopyTextProps {
  sections: QuickCopySection[];
}

export function QuickCopyText({ sections }: QuickCopyTextProps) {
  const [copiedId, setCopiedId] = useState("");
  const timerRef = useRef<number | null>(null);

  useEffect(() => () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
    }
  }, []);

  function copyValue(id: string, value: string) {
    const write = navigator.clipboard?.writeText(value || "");
    if (!write) {
      return;
    }
    void write.then(() => {
      setCopiedId(id);
      if (timerRef.current) {
        window.clearTimeout(timerRef.current);
      }
      timerRef.current = window.setTimeout(() => setCopiedId(""), 1400);
    });
  }

  if (!sections.length) {
    return <div className="quick-copy-empty">暂无可复制内容</div>;
  }

  return (
    <div className="quick-copy-list">
      {sections.map((section) => (
        <section key={section.id} className="quick-copy-section">
          <strong>{section.title}</strong>
          <div>
            {section.entries.map((entry) => {
              const copied = copiedId === entry.id;
              return (
                <button
                  key={entry.id}
                  className={copied ? "quick-copy-row copied" : "quick-copy-row"}
                  onClick={() => copyValue(entry.id, entry.value)}
                  type="button"
                >
                  <span>{entry.label}</span>
                  <code>{entry.value || "-"}</code>
                  <i aria-hidden="true">{copied ? <Check size={15} /> : <Copy size={15} />}</i>
                  {copied && <em>已复制</em>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
