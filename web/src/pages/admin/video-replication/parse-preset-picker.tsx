import { App, Button, Input } from "antd";
import { useState } from "react";
import { AdminModal } from "@/pages/admin/ui/overlays";
import { SOCIAL_PARSE_PRESETS, socialParsePresetInput } from "@/lib/social-video-parse-presets";
import { importSocialVideoParseAPIs } from "@/services/api/social-video-parse";

export function ParsePresetPicker({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
    const { message } = App.useApp();
    const [selected, setSelected] = useState<string[]>([]);
    const [instance, setInstance] = useState("");
    const [busy, setBusy] = useState(false);
    const add = async () => {
        setBusy(true);
        try {
            const apis = SOCIAL_PARSE_PRESETS.filter((item) => selected.includes(item.id)).map((item) => socialParsePresetInput(item, instance));
            const result = await importSocialVideoParseAPIs({ apis, autoEnable: false, skipExisting: true });
            if (result.errors.length) throw new Error(`导入部分失败：${result.errors.join("；")}`);
            message.success(`已添加 ${result.created} 条接口草稿。请配置密钥或实例，测试通过后启用`);
            onAdded();
            onClose();
        } catch (e) {
            message.error(e instanceof Error ? e.message : "添加失败");
        } finally {
            setBusy(false);
        }
    };
    return (
        <AdminModal
            open
            title="多平台解析服务预设"
            width={880}
            onCancel={onClose}
            footer={
                <>
                    <Button disabled={busy} onClick={() => setSelected(SOCIAL_PARSE_PRESETS.filter((item) => !item.instance).map((item) => item.id))}>
                        选择全部公开 / 密钥接口
                    </Button>
                    <Button type="primary" loading={busy} disabled={!selected.length} onClick={() => void add()}>
                        添加 {selected.length} 条停用草稿
                    </Button>
                </>
            }
        >
            <p className="mb-3 text-sm">预设来自公开 SDK 和服务文档，未取得本站实测结果。公网服务有各自限流；需要密钥的接口须在编辑器配置后测试。原有接口和轮询设置保留。</p>
            <div className="grid gap-2 sm:grid-cols-2">
                {SOCIAL_PARSE_PRESETS.map((item) => (
                    <div key={item.id} className="rounded-lg border border-border p-3">
                        <label className="flex gap-2">
                            <input type="checkbox" checked={selected.includes(item.id)} disabled={busy} onChange={(e) => setSelected((value) => (e.target.checked ? [...value, item.id] : value.filter((id) => id !== item.id)))} />
                            <strong className="text-sm">{item.name}</strong>
                        </label>
                        <p className="mt-1 text-xs text-muted-foreground">{item.requirement}</p>
                        <a className="text-xs underline" href={item.source} target="_blank" rel="noreferrer">
                            查看请求合同来源
                        </a>
                        {item.instance ? <Input aria-label="Cobalt 实例地址" placeholder="https://your-cobalt.example.com/" value={instance} onChange={(e) => setInstance(e.target.value)} disabled={busy} /> : null}
                    </div>
                ))}
            </div>
        </AdminModal>
    );
}
