import { ChevronDown, ChevronUp } from "lucide-react";
import { Checkbox } from "@/components/ui/base/checkbox";
import type { StudioSetEntry } from "@/lib/ecommerce-studio/runs";

/** 套图镜头清单：勾掉这次不出的镜头，上下移动调整顺序；导出整套和详情长图都按这个顺序。 */
export function StudioShotList({ entries, unit, onToggle, onMove }: { entries: StudioSetEntry[]; unit: string; onToggle: (key: string) => void; onMove: (key: string, delta: -1 | 1) => void }) {
    let position = 0;
    return (
        <ol className="es-shots" aria-label="镜头清单">
            {entries.map((entry, index) => {
                if (entry.included) position += 1;
                return (
                    <li key={entry.key} className="es-shot" data-off={entry.included ? undefined : true}>
                        <Checkbox checked={entry.included} onChange={() => onToggle(entry.key)} aria-label={`出这${unit}：${entry.title}`} />
                        <span className="es-shot-index" aria-hidden>
                            {entry.included ? String(position).padStart(2, "0") : "—"}
                        </span>
                        <span className="es-shot-text">
                            <strong>{entry.title}</strong>
                            <span title={entry.purpose}>{entry.purpose}</span>
                        </span>
                        <span className="es-shot-move">
                            <button type="button" className="es-icon-btn" aria-label={`上移：${entry.title}`} disabled={index === 0} onClick={() => onMove(entry.key, -1)}>
                                <ChevronUp size={14} />
                            </button>
                            <button type="button" className="es-icon-btn" aria-label={`下移：${entry.title}`} disabled={index === entries.length - 1} onClick={() => onMove(entry.key, 1)}>
                                <ChevronDown size={14} />
                            </button>
                        </span>
                    </li>
                );
            })}
        </ol>
    );
}
