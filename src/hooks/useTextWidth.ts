import { useCallback, useEffect, useState } from 'react';

// src/hooks/useTextWidth.ts
// 量出标题这类单行文本的自然宽度，供手机适配按文字宽度收缩悬浮感应区。

/**
 * 观察 `ref` 所指元素的文字宽度并返回像素值。
 *
 * 浏览器 API 拿不到「文本本身多宽」，只能给一个绝对定位、不可见、按实际字体渲染的
 * 测量节点。节点平时 `display: none`，只有手机适配样式把它打开时才参与测量，因此
 * 原版布局拿到的仍是 0，不会因为多了这个节点而改变。
 *
 * `content` 作为依赖：切歌后即使节点宽度不变（同名或同长度），也要强制重新量一次。
 */
const readTextWidth = (node: HTMLElement | null): number => {
    if (!node) {
        return 0;
    }
    return node.getBoundingClientRect().width;
};

export interface TextWidthMeasurement {
    ref: (node: HTMLElement | null) => void;
    /** 文字自然宽度，未测量或上游关闭手机适配时为 0 */
    width: number;
    measured: boolean;
}

export const useTextWidth = (content: string): TextWidthMeasurement => {
    const [node, setNode] = useState<HTMLElement | null>(null);
    const [width, setWidth] = useState(0);

    const ref = useCallback((element: HTMLElement | null) => {
        setNode(element);
    }, []);

    useEffect(() => {
        if (!node) {
            setWidth(0);
            return;
        }

        const updateWidth = () => {
            const nextWidth = Math.round(readTextWidth(node));
            setWidth(current => (current === nextWidth ? current : nextWidth));
        };

        updateWidth();

        if (typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(updateWidth);
        observer.observe(node);
        return () => observer.disconnect();
    }, [node, content]);

    return { ref, width, measured: width > 0 };
};

export default useTextWidth;
