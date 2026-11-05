import { useCallback, useMemo } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminSegmented } from "../ui/controls";
import { InteriorKnowledgePanel } from "./interior-knowledge-panel";
import { InteriorModesPanel } from "./interior-modes-panel";
import { InteriorOverviewPanel, type InteriorAdminTab } from "./interior-overview-panel";
import { InteriorPresetsPanel } from "./interior-presets-panel";
import { InteriorRecordsPanel } from "./interior-records-panel";
import { InteriorSettingsPanel } from "./interior-settings-panel";
import "./interior-admin.css";

const tabs: { value: InteriorAdminTab; label: string; path: string }[] = [
    { value: "overview", label: "概览", path: "/admin/interior/overview" },
    { value: "records", label: "出图记录", path: "/admin/interior/records" },
    { value: "modes", label: "出图方式", path: "/admin/interior/modes" },
    { value: "styles", label: "风格", path: "/admin/interior/styles" },
    { value: "rooms", label: "空间", path: "/admin/interior/rooms" },
    { value: "knowledge", label: "知识库", path: "/admin/interior/knowledge" },
    { value: "settings", label: "设置", path: "/admin/interior/settings" },
];

/** 室内设计后台：出图统计、所有用户的出图记录，出图方式、风格、空间、内置知识库和全局设置。前台入口由「功能开放」里的室内设计开关控制。 */
export default function InteriorAdminPage() {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const active = useMemo<InteriorAdminTab>(() => tabs.find((tab) => pathname.startsWith(tab.path))?.value || "overview", [pathname]);
    const recordId = searchParams.get("record") || "";
    const openTab = useCallback(
        (tab: InteriorAdminTab) => {
            const target = tabs.find((item) => item.value === tab);
            if (target) navigate(target.path, { replace: true });
        },
        [navigate],
    );
    // 打开的出图记录写在地址里（?record=），从概览点失败记录会切到出图记录页签再打开。
    const openRecord = useCallback(
        (id: string) => {
            if (id && active !== "records") {
                navigate(`/admin/interior/records?record=${encodeURIComponent(id)}`, { replace: true });
                return;
            }
            setSearchParams(id ? { record: id } : {}, { replace: true });
        },
        [active, navigate, setSearchParams],
    );

    return (
        <AdminPageFrame
            title="室内设计"
            description="看用户的出图量、成功率和每一次出图的原图、效果图与提示词；配置出图方式、风格、空间和默认模型；查看 3D 模型参考的内置知识库。模板和片段只在服务端拼接，前台目录不返回。"
            actions={<AdminSegmented<InteriorAdminTab> ariaLabel="室内设计后台视图" value={active} onChange={openTab} options={tabs.map((tab) => ({ value: tab.value, label: tab.label }))} />}
            scroll
        >
            {active === "overview" ? <InteriorOverviewPanel active onOpenTab={openTab} onOpenRecord={openRecord} /> : null}
            {active === "records" ? <InteriorRecordsPanel active recordId={recordId} onOpenRecord={openRecord} /> : null}
            {active === "modes" ? <InteriorModesPanel /> : null}
            {active === "styles" ? <InteriorPresetsPanel key="style" type="style" /> : null}
            {active === "rooms" ? <InteriorPresetsPanel key="room" type="room" /> : null}
            {active === "knowledge" ? <InteriorKnowledgePanel /> : null}
            {active === "settings" ? <InteriorSettingsPanel /> : null}
        </AdminPageFrame>
    );
}
