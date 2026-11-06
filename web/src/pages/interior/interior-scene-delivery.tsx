import { useMemo, useState } from "react";
import { Button } from "antd";
import { saveAs } from "file-saver";
import { deliveryFileStem } from "@/lib/delivery-text";
import { interiorDeliveryFiles, interiorRoomSchedule, reviewInteriorScene } from "@/lib/interior/scene-delivery";
import type { SceneSpec } from "@/lib/interior/scene-spec";
import { createZip } from "@/lib/zip";
import { getActiveUserScope } from "@/lib/user-scope";

export function InteriorSceneDelivery({ spec, onError }: { spec: SceneSpec; onError?: (error: string) => void }) {
    const [busy, setBusy] = useState(false);
    const rooms = useMemo(() => interiorRoomSchedule(spec), [spec]);
    const issues = useMemo(() => reviewInteriorScene(spec), [spec]);
    const download = async () => {
        const scope = getActiveUserScope();
        setBusy(true);
        try {
            const zip = await createZip(interiorDeliveryFiles(spec));
            if (getActiveUserScope() !== scope) return;
            saveAs(zip, `${deliveryFileStem(spec.title)}-方案包.zip`);
        } catch (error) {
            onError?.(error instanceof Error ? error.message : "方案包导出失败");
        } finally {
            setBusy(false);
        }
    };
    return (
        <details className="itd-scene-delivery">
            <summary>
                方案交付与检查 · {rooms.length} 个空间 · {issues.length - 1} 项待核对
            </summary>
            <div className="itd-scene-delivery-body">
                <p>导出可编辑平面草图、房间面积、家具清单和完整场景数据。尺寸需现场核实。</p>
                <table>
                    <thead>
                        <tr>
                            <th>楼层</th>
                            <th>空间</th>
                            <th>方案净面积</th>
                            <th>家具</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rooms.map((row, index) => (
                            <tr key={index}>
                                <td>{row.floor}</td>
                                <td>{row.room}</td>
                                <td>{row.areaM2} ㎡</td>
                                <td>{row.furniture} 件</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
                <ul>
                    {issues.map((issue, index) => (
                        <li key={index}>{issue.message}</li>
                    ))}
                </ul>
                <Button loading={busy} disabled={!rooms.length} onClick={() => void download()}>
                    下载方案包
                </Button>
            </div>
        </details>
    );
}
