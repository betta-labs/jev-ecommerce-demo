"use client";

import { useState } from "react";

interface TriageResult {
    success: boolean;
    answers: {
        category?: {
            type: string;
            choice: string;
            probabilities?: Record<string, number>;
            confidence?: number;
        };
        urgency?: {
            type: string;
            score: number;
            probabilities?: Record<string, number>;
            confidence?: number;
        };
        wants_refund?: {
            type: string;
            probability: number;
        };
        angry?: {
            type: string;
            probability: number;
        };
    };
    decision: {
        final: string;
        priority: string;
        category?: string;
        reason?: string;
    };
    usage?: {
        inputTokens?: number;
        outputTokens?: number;
    };
}

const EXAMPLE_MESSAGES = [
    {
        label: "清晰物流问题",
        text: "订单202609180023，快递显示已签收但我没收到，单号SF1234567890，请帮忙查一下。",
    },
    {
        label: "模糊质量/尺码",
        text: "衣服有点问题，尺码好像不太对，而且感觉质量一般，想处理一下。",
    },
    {
        label: "情绪激烈+要求退款",
        text: "这都第二次出问题了！上次说好补发到现在还没影，我要求全额退款，再这样我就去投诉平台和消协！",
    },
];

export default function Home() {
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<TriageResult | null>(null);
    const [error, setError] = useState("");
    const [showRaw, setShowRaw] = useState(false);

    const handleAnalyze = async () => {
        if (!message.trim()) {
            setError("请输入售后消息");
            return;
        }

        setLoading(true);
        setError("");
        setResult(null);
        setShowRaw(false);

        try {
            const res = await fetch("/api/triage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: message.trim() }),
            });

            const data = await res.json();

            if (!res.ok) {
                throw new Error(data.error || "分析失败");
            }

            setResult(data);
        } catch (err: any) {
            setError(err.message || "请求失败，请稍后重试");
        } finally {
            setLoading(false);
        }
    };

    const getProbabilityColor = (prob: number, isTop = false) => {
        if (isTop) return "bg-amber-500";
        if (prob >= 0.6) return "bg-emerald-500";
        if (prob >= 0.25) return "bg-amber-500/80";
        return "bg-zinc-600";
    };

    const formatPercent = (value?: number) => {
        if (value === undefined || value === null) return "-";
        return `${(value * 100).toFixed(1)}%`;
    };

    const getUrgencyLabel = (score?: number) => {
        if (score === undefined || score === null) return "";
        if (score < 0.8) return "普通咨询";
        if (score < 1.6) return "轻微不便";
        if (score < 2.4) return "明显不满";
        return "强烈投诉";
    };

    return (
        <div className="min-h-screen bg-zinc-950 text-zinc-100">
            <div className="max-w-4xl mx-auto px-4 py-10">
                {/* Header */}
                <div className="text-center mb-10">
                    <h1 className="text-3xl font-bold tracking-tight mb-2">
                        电商售后智能分流 Demo
                    </h1>
                    <p className="text-zinc-400">
                        基于 TypeSafe Jev（System One）·
                        一次调用并行返回多个决策
                    </p>
                </div>

                {/* Input Area */}
                <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 mb-8">
                    <label className="block text-sm font-medium text-zinc-300 mb-3">
                        输入售后消息
                    </label>
                    <textarea
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="粘贴或输入顾客的售后消息..."
                        rows={4}
                        className="w-full bg-zinc-950 border border-zinc-700 rounded-xl px-4 py-3 text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                    />

                    {/* Example Buttons */}
                    <div className="flex flex-wrap gap-2 mt-4">
                        {EXAMPLE_MESSAGES.map((ex) => (
                            <button
                                key={ex.label}
                                onClick={() => {
                                    setMessage(ex.text);
                                    setResult(null);
                                    setError("");
                                }}
                                className="text-xs px-3 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition"
                            >
                                {ex.label}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={handleAnalyze}
                        disabled={loading}
                        className="mt-5 w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:cursor-not-allowed font-medium transition"
                    >
                        {loading ? "Jev 并行评估中..." : "开始分析"}
                    </button>

                    {error && (
                        <p className="mt-3 text-sm text-rose-400 text-center">
                            {error}
                        </p>
                    )}
                </div>

                {/* Results */}
                {result && (
                    <div className="space-y-6">
                        {/* Final Decision */}
                        <div className="bg-gradient-to-r from-blue-900/40 to-indigo-900/40 border border-blue-700/50 rounded-2xl p-6">
                            <div className="text-sm text-blue-300 mb-1">
                                最终决策建议
                            </div>
                            <div className="text-2xl font-semibold mb-2">
                                {result.decision.final}
                            </div>
                            <div className="flex flex-wrap gap-3 text-sm mb-3">
                                <span className="px-3 py-1 rounded-full bg-zinc-800">
                                    优先级：{result.decision.priority}
                                </span>
                                {result.decision.category && (
                                    <span className="px-3 py-1 rounded-full bg-zinc-800">
                                        路由：{result.decision.category}
                                    </span>
                                )}
                            </div>
                            {result.decision.reason && (
                                <p className="text-sm text-zinc-300 leading-relaxed border-t border-blue-800/40 pt-3">
                                    {result.decision.reason}
                                </p>
                            )}
                        </div>

                        {/* Four Decision Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Category - Choice */}
                            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-sm text-zinc-400">
                                        路由分组
                                    </div>
                                    <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                                        Choice
                                    </span>
                                </div>
                                <div className="text-xl font-medium mb-3">
                                    {result.answers.category?.choice || "-"}
                                </div>
                                {result.answers.category?.probabilities && (
                                    <div className="space-y-2">
                                        {Object.entries(
                                            result.answers.category
                                                .probabilities,
                                        )
                                            .sort(([, a], [, b]) => b - a)
                                            .map(([key, prob], index) => (
                                                <div
                                                    key={key}
                                                    className="flex items-center gap-2 text-sm"
                                                >
                                                    <span className="w-28 truncate text-zinc-400">
                                                        {key}
                                                    </span>
                                                    <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full transition-all ${getProbabilityColor(prob, index === 0)}`}
                                                            style={{
                                                                width: `${Math.max(prob * 100, 2)}%`,
                                                            }}
                                                        />
                                                    </div>
                                                    <span className="w-12 text-right tabular-nums">
                                                        {formatPercent(prob)}
                                                    </span>
                                                </div>
                                            ))}
                                    </div>
                                )}
                            </div>

                            {/* Urgency - Score */}
                            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-sm text-zinc-400">
                                        紧急程度
                                    </div>
                                    <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                                        Score
                                    </span>
                                </div>
                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className="text-xl font-medium">
                                        {result.answers.urgency?.score?.toFixed(
                                            2,
                                        ) ?? "-"}
                                    </span>
                                    <span className="text-sm text-zinc-400">
                                        {getUrgencyLabel(
                                            result.answers.urgency?.score,
                                        )}
                                    </span>
                                </div>
                                <div className="text-xs text-zinc-500 mb-3">
                                    0=普通咨询 · 3=强烈投诉
                                </div>
                                {result.answers.urgency?.probabilities && (
                                    <div className="space-y-2">
                                        {Object.entries(
                                            result.answers.urgency
                                                .probabilities,
                                        )
                                            .sort(
                                                ([a], [b]) =>
                                                    Number(a) - Number(b),
                                            )
                                            .map(([key, prob]) => (
                                                <div
                                                    key={key}
                                                    className="flex items-center gap-2 text-sm"
                                                >
                                                    <span className="w-8 text-zinc-400">
                                                        Lv{key}
                                                    </span>
                                                    <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                                                        <div
                                                            className={`h-full ${getProbabilityColor(prob)}`}
                                                            style={{
                                                                width: `${Math.max(prob * 100, 2)}%`,
                                                            }}
                                                        />
                                                    </div>
                                                    <span className="w-12 text-right tabular-nums">
                                                        {formatPercent(prob)}
                                                    </span>
                                                </div>
                                            ))}
                                    </div>
                                )}
                            </div>

                            {/* Wants Refund - Boolean */}
                            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-sm text-zinc-400">
                                        是否要求退款
                                    </div>
                                    <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                                        Boolean
                                    </span>
                                </div>
                                <div className="text-3xl font-semibold mb-1 tabular-nums">
                                    {formatPercent(
                                        result.answers.wants_refund
                                            ?.probability,
                                    )}
                                </div>
                                <div className="text-sm text-zinc-500">
                                    概率越高表示越明确要求退款/退货
                                </div>
                            </div>

                            {/* Angry - Boolean */}
                            <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-5">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-sm text-zinc-400">
                                        是否强烈不满
                                    </div>
                                    <span className="text-[10px] px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                                        Boolean
                                    </span>
                                </div>
                                <div className="text-3xl font-semibold mb-1 tabular-nums">
                                    {formatPercent(
                                        result.answers.angry?.probability,
                                    )}
                                </div>
                                <div className="text-sm text-zinc-500">
                                    概率越高表示情绪越激烈或有威胁
                                </div>
                            </div>
                        </div>

                        {/* Usage + Raw JSON */}
                        <div className="space-y-3">
                            {result.usage && (
                                <div className="text-center text-xs text-zinc-500">
                                    输入 tokens:{" "}
                                    {result.usage.inputTokens ?? "-"} · 输出
                                    tokens: {result.usage.outputTokens ?? "-"}
                                    <span className="ml-2 text-zinc-600">
                                        （Jev 输出几乎不消耗 token）
                                    </span>
                                </div>
                            )}

                            <div className="text-center">
                                <button
                                    onClick={() => setShowRaw(!showRaw)}
                                    className="text-xs text-zinc-500 hover:text-zinc-300 transition"
                                >
                                    {showRaw
                                        ? "收起原始结构化输出"
                                        : "查看原始结构化输出 (JSON)"}
                                </button>
                            </div>

                            {showRaw && (
                                <pre className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 text-xs overflow-x-auto text-zinc-400">
                                    {JSON.stringify(result.answers, null, 2)}
                                </pre>
                            )}
                        </div>
                    </div>
                )}

                {/* Footer */}
                <div className="mt-16 text-center text-xs text-zinc-600">
                    Powered by TypeSafe Jev via Vercel AI Gateway · 仅供演示
                </div>
            </div>
        </div>
    );
}
