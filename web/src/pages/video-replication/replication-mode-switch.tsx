import { SegmentedControl } from "@/components/ui/base/segmented-control";

/** 视频复刻首页的两个页签：新建复刻（放爆款、拆解记录）和我的作品（复刻工作台的作品）。 */
export type ReplicationTab = "new" | "works";

export function ReplicationTabs({ value, onChange, works }: { value: ReplicationTab; onChange: (tab: ReplicationTab) => void; works?: number }) {
    return (
        <SegmentedControl<ReplicationTab>
            ariaLabel="视频复刻"
            value={value}
            onChange={onChange}
            options={[
                { value: "new", label: "新建复刻", title: "放一条爆款视频，拆解后逐镜换成你的商品" },
                { value: "works", label: works ? `我的作品 ${works}` : "我的作品", title: "复刻好的和正在生成的作品" },
            ]}
        />
    );
}
