import { App, Button, Upload } from "antd";
import { CloudUpload, ImageIcon, Trash2 } from "lucide-react";
import { useState } from "react";
import { resourceFileUrl, uploadResourceFile } from "@/services/api/resources";

export type InteriorCover = { resourceId: string; url?: string };

/** 出图方式、风格和空间的封面图。上传成本人资源，保存时服务端校验新封面属于当前管理员且已就绪。 */
export function InteriorCoverUpload({ value, onChange, disabled, onUploadingChange }: { value: InteriorCover; onChange: (value: InteriorCover) => void; disabled?: boolean; onUploadingChange?: (uploading: boolean) => void }) {
    const { message } = App.useApp();
    const [uploading, setUploading] = useState(false);
    const preview = value.url || (value.resourceId ? `${resourceFileUrl(value.resourceId)}?variant=thumbnail` : "");
    const setBusy = (next: boolean) => {
        setUploading(next);
        onUploadingChange?.(next);
    };
    return (
        <div className="itd-admin-cover">
            <div className="itd-admin-cover-preview">{preview ? <img src={preview} alt="封面" /> : <ImageIcon className="size-5" aria-hidden />}</div>
            <div className="itd-admin-cover-actions">
                <Upload
                    accept="image/*"
                    showUploadList={false}
                    disabled={disabled || uploading}
                    beforeUpload={async (file) => {
                        if (!file.type.startsWith("image/")) {
                            message.error("请选择图片文件");
                            return false;
                        }
                        setBusy(true);
                        try {
                            const resource = await uploadResourceFile(file, "image", { fileName: file.name });
                            onChange({ resourceId: resource.id });
                        } catch (error) {
                            message.error(error instanceof Error && error.message ? error.message : "封面上传失败");
                        } finally {
                            setBusy(false);
                        }
                        return false;
                    }}
                >
                    <Button size="small" loading={uploading} disabled={disabled} icon={<CloudUpload className="size-3.5" aria-hidden />}>
                        {value.resourceId ? "替换封面" : "上传封面"}
                    </Button>
                </Upload>
                {value.resourceId ? (
                    <Button size="small" type="text" danger disabled={disabled || uploading} icon={<Trash2 className="size-3.5" aria-hidden />} onClick={() => onChange({ resourceId: "" })}>
                        移除
                    </Button>
                ) : null}
            </div>
        </div>
    );
}
