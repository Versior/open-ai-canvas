import { useCallback, useEffect, useMemo, useState } from "react";


import { getAddedSkillsCatalogRevision, listAddedSkills, type Skill } from "@/services/api/skills";
import { SKILL_RUNTIME_PROFILES, type SkillRuntimeProfile } from "@/services/skill-runtime";
import { Select } from "@/components/ui/base/select";
import { useUserStore } from "@/stores/use-user-store";
import { getActiveUserScope } from "@/lib/user-scope";

export function useSkillRuntimeCatalog() {
    const userId = useUserStore((state) => state.user?.id);
    const [catalog, setCatalog] = useState({ userId, skills: [] as Skill[], loading: true, error: "" });
    const [revision, setRevision] = useState(-1);
    const refresh = useCallback(() => setRevision(getAddedSkillsCatalogRevision()), []);

    useEffect(() => {
        window.addEventListener("canvas-skills-changed", refresh);
        window.addEventListener("focus", refresh);
        return () => {
            window.removeEventListener("canvas-skills-changed", refresh);
            window.removeEventListener("focus", refresh);
        };
    }, [refresh]);

    useEffect(() => {
        let cancelled = false;
        const scope = getActiveUserScope();
        const isCurrent = () => !cancelled && getActiveUserScope() === scope && useUserStore.getState().user?.id === userId;
        setCatalog((previous) => ({ userId, skills: previous.userId === userId ? previous.skills : [], loading: true, error: "" }));
        listAddedSkills({ force: true, afterRevision: revision })
            .then((result) => {
                if (isCurrent()) setCatalog({ userId, skills: result.skills.filter((skill) => skill.isAdded), loading: false, error: "" });
            })
            .catch((error) => {
                if (isCurrent()) setCatalog({ userId, skills: [], loading: false, error: error instanceof Error ? error.message : "技能库读取失败" });
            });
        return () => {
            cancelled = true;
        };
    }, [userId, revision]);

    // A new account must not see the previous catalog before its effect has run.
    const { skills, loading, error } = catalog.userId === userId ? catalog : { skills: [], loading: true, error: "" };
    return { skills, loading, error, refresh };
}

export function SkillRuntimePicker({ skills, loading, value, onChange, placeholder = "选择本次生成使用的技能", profile = "canvas", className, ariaLabel = "本次生成使用的技能" }: { skills: Skill[]; loading?: boolean; value: string[]; onChange: (skillIds: string[]) => void; placeholder?: string; profile?: SkillRuntimeProfile; /** 嵌在工具条里时传宽度类，默认撑满 */ className?: string; ariaLabel?: string }) {
    const options = useMemo(
        () => skills.map((skill) => ({ value: skill.skillId, label: skill.skillName, title: skill.description })),
        [skills],
    );
    const maxSkills = SKILL_RUNTIME_PROFILES[profile].maxSkills;

    // 不传 className 就是「占满表单」（章节/分镜那些表单里的默认），
    // 传了就是嵌在工具条里的窄控件。两件事分开写，别让窄控件去覆盖表单的宽度。
    const sizingProps = className ? { className } : { className: "w-full", style: { width: "100%" } };
    return (
        <Select
            {...sizingProps}
            mode="multiple"
            allowClear
            showSearch
            maxCount={maxSkills || undefined}
            maxTagCount="responsive"
            loading={loading}
            value={value}
            placeholder={placeholder}
            optionFilterProp="label"
            options={options}
            onChange={onChange}
            notFoundContent={loading ? "正在读取已加入的技能" : "没有已加入的技能，请打开 Skills 库添加"}
            aria-label={ariaLabel}
            getPopupContainer={(trigger) => trigger.closest(".ecom-suite-shell") || trigger.parentElement || document.body}
        />
    );
}
