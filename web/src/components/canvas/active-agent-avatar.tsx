import { Orbit } from "lucide-react";
import { useState } from "react";
import { useActiveAgentPet } from "@/hooks/use-active-agent-pet";
import { agentPetPreviewURL } from "@/services/api/agent-pets";

/** 对话头像和浮动助手共享服务端当前形象，静态首帧避免消息列表重复播放动画。 */
export function ActiveAgentAvatar() {
    const { pet } = useActiveAgentPet();
    const [failed, setFailed] = useState("");
    const src = pet ? agentPetPreviewURL(pet) : "";
    return src && src !== failed ? <img src={src} alt={pet?.name || "助手"} className="size-full object-contain" onError={() => setFailed(src)} /> : <Orbit aria-hidden />;
}
