import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { AgentPetSize } from "@/lib/canvas/agent-pet";

/** 形象在本机的显示偏好；当前用哪个形象存在服务端。 */
type AgentPetPrefsStore = {
    /** 头顶气泡的闲聊（问候、时间、灵感、未完成提醒）。关闭后仍会提示待审批。 */
    chatter: boolean;
    /** 形象大小，auto 跟随站点设置。 */
    size: AgentPetSize;
    setChatter: (chatter: boolean) => void;
    setSize: (size: AgentPetSize) => void;
};

export const useAgentPetPrefsStore = create<AgentPetPrefsStore>()(
    persist(
        (set) => ({
            chatter: true,
            size: "auto",
            setChatter: (chatter) => set({ chatter }),
            setSize: (size) => set({ size }),
        }),
        { name: "yingce:agent_pet_prefs", version: 1 },
    ),
);
