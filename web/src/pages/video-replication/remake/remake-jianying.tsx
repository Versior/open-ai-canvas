import { App, Input } from "antd";
import { useState } from "react";
import { AppModal } from "@/components/ui/product/app-modal/app-modal";
import type { RemakeJob } from "@/lib/remake/job";
import { remakeRenderSize, remakeTimeline } from "@/lib/remake/timeline";
import { defaultJianyingDraftRoot, exportTimelineJianyingDraft, jianyingDraftRootProblem, savedJianyingDraftRoot, saveJianyingDraftRoot } from "@/services/drama-export";

/**
 * 导出剪映草稿：成片的时间线原样交给后端打包（画面在主轨、配音 / 原声 / 音乐在音频轨、台词在字幕轨），
 * 素材按用户本机的剪映草稿目录写成绝对路径。字幕在剪映里是可编辑的文字，不带烧录的字幕图。
 */
export function RemakeJianyingModal({ job, onClose }: { job: RemakeJob; onClose: () => void }) {
    const { message } = App.useApp();
    const [root, setRoot] = useState(() => savedJianyingDraftRoot() || defaultJianyingDraftRoot());
    const problem = jianyingDraftRootProblem(root);
    const submit = () => {
        if (problem) return;
        let timeline;
        try {
            const size = job.render?.width && job.render.height ? { width: job.render.width, height: job.render.height } : remakeRenderSize(job);
            timeline = remakeTimeline({ ...job, subtitles: { burn: false } }, size);
        } catch (error) {
            message.error(`还不能导出：${error instanceof Error ? error.message : "请先拼一次成片"}`);
            return;
        }
        saveJianyingDraftRoot(root);
        exportTimelineJianyingDraft(timeline, { draftRoot: root, name: job.title }, (text) => message.error(text));
        message.info("正在生成剪映草稿，浏览器会开始下载");
        onClose();
    };
    return (
        <AppModal open onCancel={onClose} width={600} centered title="导出剪映草稿" okText="导出草稿" cancelText="取消" onOk={submit} okButtonProps={{ disabled: Boolean(problem) }}>
            <div className="rw-jianying">
                <label className="rw-jianying-field">
                    <span>剪映草稿目录</span>
                    <Input value={root} onChange={(event) => setRoot(event.target.value)} status={problem ? "warning" : undefined} spellCheck={false} aria-label="剪映草稿目录" />
                    <small data-problem={problem ? true : undefined}>{problem || "在剪映专业版「全局设置 → 草稿位置」查看。素材路径按这个目录写入草稿，只保存在本机浏览器。"}</small>
                </label>
                <ol>
                    <li>主轨是成片画面，配音、原声和背景音乐各在一条音频轨，台词在字幕轨，都能在剪映里接着改。</li>
                    <li>关闭剪映，把下载的压缩包解压到上面的目录，草稿文件夹要直接位于该目录下，不要改名。</li>
                    <li>重新打开剪映，在首页草稿列表里打开同名草稿。素材显示丢失时，在剪映里重新链接草稿内 materials 目录。</li>
                </ol>
            </div>
        </AppModal>
    );
}
