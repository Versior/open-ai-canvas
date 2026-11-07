import { AGENT_SKINS, type ResolvedAgentSkin } from "@/lib/canvas/agent-skin";
import { agentPetPreviewURL, type AgentPet } from "@/services/api/agent-pets";
import { useAgentPetPrefsStore } from "@/stores/use-agent-pet-prefs-store";
import "./agent-skin-scene.css";

/** 原创矢量装饰；角色图沿用当前用户已选择的形象资源。 */
export function AgentSkinScene({ skin, pet }: { skin: ResolvedAgentSkin; pet: AgentPet | null }) {
    const preference = useAgentPetPrefsStore((state) => state.skin);
    const setSkin = useAgentPetPrefsStore((state) => state.setSkin);
    const title = { cloud: "云上小屋", paper: "灵感手账", terminal: "机械工坊", aurora: "星际信箱", site: "工作台" }[skin];
    return (
        <section className="agent-skin-scene" aria-label="对话皮肤">
            {skin !== "site" ? (
                <svg className="agent-skin-art" viewBox="0 0 600 110" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
                    {skin === "cloud" ? (
                        <>
                            <path d="M0 85Q50 45 110 77T240 70T370 83T510 64T650 80V110H0Z" fill="currentColor" opacity=".14" />
                            <path d="M345 38c-10-25-41-16-42 0-20-5-31 24-10 28h87c23-5 15-30-6-25-1-19-20-23-29-3Z" fill="currentColor" opacity=".5" />
                            <path d="M486 55c-10-24-35-21-42-4-19-4-32 22-9 27h87c17-6 10-30-10-24-8-18-23-15-26 1Z" fill="currentColor" opacity=".2" />
                            <circle cx="546" cy="26" r="15" fill="currentColor" opacity=".6" />
                            <path d="M531 26h30M546 11v30" stroke="currentColor" strokeWidth="2" />
                            <path d="M405 85v20m-17-20q17-30 34 0Z" fill="currentColor" opacity=".7" />
                            <circle cx="404" cy="79" r="3" fill="var(--agent-surface-base)" />
                        </>
                    ) : skin === "paper" ? (
                        <>
                            <path d="M270 0v110M300 0v110M330 0v110M360 0v110M390 0v110M420 0v110M450 0v110M480 0v110M510 0v110M540 0v110M570 0v110M600 0v110M260 20h340M260 50h340M260 80h340" stroke="currentColor" opacity=".12" />
                            <g transform="translate(310 14) rotate(-9)">
                                <rect width="86" height="66" rx="5" fill="var(--agent-surface-base)" stroke="currentColor" strokeWidth="2" />
                                <path d="M15 21h55M15 33h36M15 45h48" stroke="currentColor" opacity=".6" />
                                <path d="M28-5h32v14H28Z" fill="currentColor" opacity=".35" />
                            </g>
                            <path d="m461 18 8 19 20 2-15 14 4 22-17-11-18 11 4-22-15-14 21-2Z" fill="none" stroke="currentColor" strokeWidth="3" />
                            <g transform="translate(545 55)">
                                <path d="M0 0v50m0-30 16-9M0 34l-16-7" stroke="currentColor" strokeWidth="3" />
                                <circle cx="0" cy="-9" r="12" fill="currentColor" opacity=".4" />
                                <circle cx="-11" cy="3" r="12" fill="currentColor" opacity=".4" />
                                <circle cx="11" cy="3" r="12" fill="currentColor" opacity=".4" />
                                <circle r="6" fill="currentColor" />
                            </g>
                        </>
                    ) : skin === "terminal" ? (
                        <>
                            <path d="M260 20h65l15 20h55m-125 48h88l20-24h48M435 0v22l20 20h75M590 80h-75l-25-24" stroke="currentColor" strokeWidth="2" fill="none" opacity=".6" />
                            {[
                                [260, 20],
                                [270, 88],
                                [395, 40],
                                [426, 64],
                                [530, 42],
                                [590, 80],
                            ].map(([cx, cy]) => (
                                <circle key={`${cx}:${cy}`} cx={cx} cy={cy} r="4" fill="currentColor" />
                            ))}
                            <g transform="translate(450 48)">
                                <path d="M-28-18h56l10 10v37l-10 10h-56l-10-10V-8Z" fill="var(--agent-surface-base)" stroke="currentColor" strokeWidth="3" />
                                <path d="M0-18v-12" stroke="currentColor" strokeWidth="3" />
                                <circle cy="-33" r="4" fill="currentColor" />
                                <rect x="-20" y="-6" width="40" height="16" rx="3" fill="currentColor" opacity=".3" />
                                <path d="M-12 0v4M12 0v4M-12 22h24" stroke="currentColor" strokeWidth="3" />
                            </g>
                        </>
                    ) : (
                        <>
                            <path d="m298 22 45 35 50-42 37 53 45-31" stroke="currentColor" fill="none" opacity=".4" />
                            {[
                                [298, 22],
                                [343, 57],
                                [393, 15],
                                [430, 68],
                                [475, 37],
                            ].map(([cx, cy]) => (
                                <path key={`${cx}:${cy}`} d={`M${cx - 4} ${cy}h8M${cx} ${cy - 4}v8`} stroke="currentColor" strokeWidth="2" />
                            ))}
                            <g transform="translate(525 51) rotate(-22)">
                                <circle r="25" fill="currentColor" opacity=".18" />
                                <ellipse rx="45" ry="9" fill="none" stroke="currentColor" strokeWidth="3" />
                                <path d="M-20-10q20 14 42 8M-22 6q20 15 40 12" fill="none" stroke="currentColor" opacity=".3" />
                            </g>
                            <path d="m370 83 9 6-17 9-4-13Z" fill="currentColor" />
                            <path d="m360 92-22 11" stroke="currentColor" strokeWidth="2" opacity=".5" />
                        </>
                    )}
                </svg>
            ) : null}
            <div className="agent-skin-scene-copy">
                <small>{pet?.name || "STAGE"} 的对话空间</small>
                <strong>{title}</strong>
            </div>
            {pet ? <img className="agent-skin-character" src={agentPetPreviewURL(pet)} alt="" /> : null}
            <label className="agent-skin-choice">
                <span className="sr-only">对话皮肤</span>
                <select aria-label="对话皮肤" value={preference} onChange={(event) => setSkin(event.target.value as typeof preference)}>
                    {AGENT_SKINS.map((item) => (
                        <option key={item.id} value={item.id}>
                            {item.label}
                        </option>
                    ))}
                </select>
            </label>
        </section>
    );
}
