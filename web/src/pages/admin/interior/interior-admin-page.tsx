import { useMemo } from "react";
import { useLocation, useNavigate } from "react-router";
import { AdminPageFrame } from "../components/admin-shell";
import { AdminSegmented } from "../ui/controls";
import { InteriorModesPanel } from "./interior-modes-panel";
import { InteriorPresetsPanel } from "./interior-presets-panel";
import { InteriorSettingsPanel } from "./interior-settings-panel";
import "./interior-admin.css";

const tabs = [
    { value: "modes", label: "出图方式", path: "/admin/interior/modes" },
    { value: "styles", label: "风格", path: "/admin/interior/styles" },
    { value: "rooms", label: "空间", path: "/admin/interior/rooms" },
    { value: "settings", label: "设置", path: "/admin/interior/settings" },
] as const;

type Tab = (typeof tabs)[number]["value"];

/** 室内设计后台：出图方式、风格、空间和全局设置。前台入口由「功能开放」里的室内设计开关控制。 */
export default function InteriorAdminPage() {
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const active = useMemo<Tab>(() => tabs.find((tab) => pathname.startsWith(tab.path))?.value || "modes", [pathname]);

    return (
        <AdminPageFrame
            title="室内设计配置"
            description="配置室内设计页的出图方式、风格、空间和默认模型。模板和片段只在服务端拼接，前台目录不返回；拼好的完整提示词会记在用户自己的任务里。"
            actions={
                <AdminSegmented<Tab>
                    ariaLabel="室内设计配置视图"
                    value={active}
                    onChange={(value) => {
                        const target = tabs.find((tab) => tab.value === value);
                        if (target) navigate(target.path, { replace: true });
                    }}
                    options={tabs.map((tab) => ({ value: tab.value, label: tab.label }))}
                />
            }
            scroll
        >
            {active === "modes" ? <InteriorModesPanel /> : null}
            {active === "styles" ? <InteriorPresetsPanel key="style" type="style" /> : null}
            {active === "rooms" ? <InteriorPresetsPanel key="room" type="room" /> : null}
            {active === "settings" ? <InteriorSettingsPanel /> : null}
        </AdminPageFrame>
    );
}
