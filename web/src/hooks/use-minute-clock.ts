import { useEffect, useState } from "react";

/** 每分钟刷新一次的当前时间，用于促销倒计时这类分钟级显示。 */
export function useMinuteClock() {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 60_000);
        return () => window.clearInterval(timer);
    }, []);
    return now;
}
