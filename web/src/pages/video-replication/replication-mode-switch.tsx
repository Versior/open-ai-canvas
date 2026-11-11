import { SegmentedControl } from "@/components/ui/base/segmented-control";

/** 视频复刻首页的两个页签：新建复刻（放爆款、拆解记录）和我的作品（复刻工作台的作品）。 */
export type ReplicationTab = "new" | "works";

export function ReplicationTabs({ value, onChange, works }: { value: ReplicationTab; onChange: (tab: ReplicationTab) => void; works?: number }) {
    return (
        <SegmentedControl<ReplicationTab>
            ariaLabel="视频创作"
            value={value}
            onChange={onChange}
            options={[
                { value: "new", label: "新建视频", title: "从商品图策划新视频，或上传原视频拆解复刻" },
                { value: "works", label: works ? `我的作品 ${works}` : "我的作品", title: "策划、生成和已经完成的视频作品" },
            ]}
        />
    );
}
