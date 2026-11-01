import { create } from "zustand";
import { persist } from "zustand/middleware";

type AgentPetBubbleStore = {
    /** 头顶气泡的闲聊（问候、时间、灵感、未完成提醒）。关闭后仍会提示待审批。 */
    chatter: boolean;
    setChatter: (chatter: boolean) => void;
};

export const useAgentPetBubbleStore = create<AgentPetBubbleStore>()(
    persist(
        (set) => ({
            chatter: true,
            setChatter: (chatter) => set({ chatter }),
        }),
        { name: "yingce:agent_pet_bubble", version: 1 },
    ),
);
