"use client";

import { useRef, useState } from "react";
import {
    CATEGORY_LABELS,
    RULE_LABELS,
    type TriageDecision,
} from "@/lib/triage";

interface TriageResult {
    success: boolean;
    answers: {
        category?: {
            type: string;
            choice: string;
            probabilities?: Record<string, number>;
        };
        urgency?: {
            type: string;
            score: number;
            probabilities?: Record<string, number>;
        };
        wants_refund?: { type: string; probability: number };
        angry?: { type: string; probability: number };
    };
    decision: TriageDecision;
    confidence?: Record<string, number>;
    meta?: {
        latencyMs?: number;
        model?: string;
        responseId?: string;
        usage?: { inputTokens?: number; outputTokens?: number };
    };
}

const MAX_MESSAGE_LENGTH = 2000;

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
    {
        label: "支付异常",
        text: "我明明只买了一件，为什么被扣了两次钱？麻烦查一下订单202609190011的扣款记录。",
    },
];

const URGENCY_LEVELS = ["普通咨询", "轻微不便", "明显不满", "强烈投诉"];

const PRIORITY_STYLES: Record<
    string,
    { chip: string; banner: string; accent: string }
> = {
    高优: {
        chip: "border-rose-500/40 bg-rose-500/10 text-rose-300",
        banner: "from-rose-950/60 via-zinc-900/80 to-zinc-900/80 border-rose-800/50",
        accent: "bg-rose-500",
    },
    较高: {
        chip: "border-amber-500/40 bg-amber-500/10 text-amber-300",
        banner: "from-amber-950/50 via-zinc-900/80 to-zinc-900/80 border-amber-800/50",
        accent: "bg-amber-500",
    },
    普通: {
        chip: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
        banner: "from-emerald-950/50 via-zinc-900/80 to-zinc-900/80 border-emerald-800/40",
        accent: "bg-emerald-500",
    },
};

/* ---------- 小图标（内联 SVG，无额外依赖） ---------- */

function Icon({ d, className = "size-4" }: { d: string; className?: string }) {
    return (
        <svg
            className={className}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
        >
            <path d={d} />
        </svg>
    );
}

const ICONS = {
    route: "M6 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4Zm12-10a2 2 0 1 0 0-4 2 2 0 0 0 0 4ZM8 17h5a4 4 0 0 0 4-4V9M6 15V9a3 3 0 0 1 3-3h3",
    gauge: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm2.2-8.6L18 3M4.9 19.1a10 10 0 1 1 14.2 0",
    refund: "M3 12a9 9 0 1 0 3-6.7L3 8m0-5v5h5",
    alert: "M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z",
    bolt: "M13 2 4 14h6l-1 8 9-12h-6l1-8Z",
    clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-13v5l3 2",
    cpu: "M9 9h6v6H9V9Zm-4 6H3v-3m2-3H3V6h2m14 6h2v3m-2-6h2v3M5 5h14v14H5V5Z",
    spark: "M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9L12 3Zm7 8.5.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z",
};

/* ---------- 工具函数 ---------- */

const formatPercent = (value?: number) => {
    if (value === undefined || value === null) return "-";
    return `${(value * 100).toFixed(1)}%`;
};

const formatConfidence = (value?: number) => {
    if (value === undefined || value === null) return undefined;
    return value <= 1 ? `${(value * 100).toFixed(0)}%` : value.toFixed(1);
};

const getUrgencyLevel = (score?: number) => {
    if (score === undefined || score === null) return -1;
    return Math.min(3, Math.round(score));
};

/* ---------- 子组件 ---------- */

function ConfidenceChip({ value }: { value?: number }) {
    const text = formatConfidence(value);
    if (!text) return null;
    return (
        <span className="inline-flex items-center gap-1 rounded-full border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] text-violet-300">
            <Icon d={ICONS.spark} className="size-3" />
            模型置信度 {text}
        </span>
    );
}

function ProbabilityBar({
    prob,
    highlight = false,
}: {
    prob: number;
    highlight?: boolean;
}) {
    const barClass = highlight
        ? "bg-gradient-to-r from-indigo-500 to-violet-400"
        : prob >= 0.25
          ? "bg-indigo-500/50"
          : "bg-zinc-600";
    return (
        <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-800/80">
            <div
                className={`h-full rounded-full transition-all duration-500 ${barClass}`}
                style={{ width: `${Math.max(prob * 100, 2)}%` }}
            />
        </div>
    );
}

function CardShell({
    title,
    icon,
    type,
    children,
    footer,
}: {
    title: string;
    icon: string;
    type: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
}) {
    return (
        <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-5 backdrop-blur">
            <div className="mb-3 flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-zinc-400">
                    <Icon d={icon} className="size-4 text-zinc-500" />
                    {title}
                </div>
                <span className="rounded-md bg-zinc-800/80 px-2 py-0.5 font-mono text-[10px] tracking-wide text-zinc-500">
                    {type}
                </span>
            </div>
            {children}
            {footer && (
                <div className="mt-3 border-t border-zinc-800/60 pt-3">
                    {footer}
                </div>
            )}
        </div>
    );
}

function StatItem({
    icon,
    label,
    value,
}: {
    icon: string;
    label: string;
    value: string;
}) {
    return (
        <div className="flex items-center gap-2">
            <Icon d={icon} className="size-3.5 text-zinc-600" />
            <span className="text-zinc-500">{label}</span>
            <span className="font-mono tabular-nums text-zinc-300">{value}</span>
        </div>
    );
}

function BooleanDisplay({
    probability,
    danger = false,
}: {
    probability?: number;
    danger?: boolean;
}) {
    const value = probability ?? 0;
    const isYes = value >= 0.5;
    const barClass = isYes
        ? danger
            ? "bg-gradient-to-r from-amber-500 to-rose-500"
            : "bg-gradient-to-r from-indigo-500 to-violet-400"
        : "bg-zinc-600";

    return (
        <div>
            <div className="mb-3 flex items-baseline gap-2">
                <span className="font-mono text-3xl font-semibold tabular-nums">
                    {formatPercent(probability)}
                </span>
                <span
                    className={`rounded-full border px-2 py-0.5 text-xs ${
                        isYes
                            ? danger
                                ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
                                : "border-indigo-500/40 bg-indigo-500/10 text-indigo-300"
                            : "border-zinc-700 bg-zinc-800/50 text-zinc-500"
                    }`}
                >
                    {isYes ? "倾向：是" : "倾向：否"}
                </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-800/80">
                <div
                    className={`h-full rounded-full transition-all duration-500 ${barClass}`}
                    style={{ width: `${Math.max(value * 100, 2)}%` }}
                />
            </div>
        </div>
    );
}

/* ---------- 页面 ---------- */

export default function Home() {
    const [message, setMessage] = useState("");
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<TriageResult | null>(null);
    const [error, setError] = useState("");
    const [showRaw, setShowRaw] = useState(false);

    const abortRef = useRef<AbortController | null>(null);
    const seqRef = useRef(0);

    const handleAnalyze = async () => {
        if (!message.trim()) {
            setError("请输入售后消息");
            return;
        }

        // 竞态防护：取消上一次未完成的请求
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;
        const seq = ++seqRef.current;

        setLoading(true);
        setError("");
        setResult(null);
        setShowRaw(false);

        try {
            const res = await fetch("/api/triage", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message: message.trim() }),
                signal: controller.signal,
            });

            const data: TriageResult = await res.json();

            // 已被更新的请求取代，丢弃本次结果
            if (seq !== seqRef.current) return;

            if (!res.ok) {
                throw new Error(
                    (data as unknown as { error?: string }).error || "分析失败",
                );
            }

            setResult(data);
        } catch (err) {
            if (controller.signal.aborted) return;
            setError(err instanceof Error ? err.message : "请求失败，请稍后重试");
        } finally {
            if (seq === seqRef.current) setLoading(false);
        }
    };

    const priorityStyle =
        PRIORITY_STYLES[result?.decision.priority ?? "普通"] ??
        PRIORITY_STYLES["普通"];

    return (
        <div className="relative min-h-screen overflow-hidden bg-zinc-950 text-zinc-100">
            {/* 背景光晕 */}
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_100%_at_50%_0%,rgba(99,102,241,0.16),transparent_70%)]"
            />
            <div
                aria-hidden="true"
                className="pointer-events-none absolute inset-x-0 top-[300px] h-[300px] bg-[radial-gradient(50%_100%_at_80%_0%,rgba(217,70,239,0.07),transparent_70%)]"
            />

            <div className="relative mx-auto max-w-4xl px-4 py-12">
                {/* Header */}
                <header className="mb-10 text-center">
                    <div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-indigo-500/30 bg-indigo-500/10 px-3 py-1 text-xs text-indigo-300">
                        <Icon d={ICONS.spark} className="size-3.5" />
                        TypeSafe Jev · Evaluation API
                        <span className="text-indigo-500/60">·</span>
                        一次调用 · 4 个问题
                    </div>
                    <h1 className="mb-3 bg-gradient-to-r from-zinc-100 via-indigo-200 to-violet-300 bg-clip-text text-4xl font-bold tracking-tight text-transparent">
                        电商售后智能分流
                    </h1>
                    <p className="text-sm leading-relaxed text-zinc-400">
                        路由分组、紧急程度、退款意愿、情绪判断 ——
                        全部带概率分布与置信度
                    </p>
                </header>

                {/* Input */}
                <section className="mb-8 rounded-2xl border border-zinc-800/80 bg-zinc-900/60 p-6 shadow-2xl shadow-black/40 backdrop-blur">
                    <div className="mb-3 flex items-center justify-between">
                        <label
                            htmlFor="message"
                            className="flex items-center gap-2 text-sm font-medium text-zinc-300"
                        >
                            <Icon
                                d={ICONS.route}
                                className="size-4 text-zinc-500"
                            />
                            输入售后消息
                        </label>
                        <span
                            className={`font-mono text-[11px] tabular-nums ${
                                message.length > MAX_MESSAGE_LENGTH * 0.9
                                    ? "text-amber-400"
                                    : "text-zinc-600"
                            }`}
                        >
                            {message.length} / {MAX_MESSAGE_LENGTH}
                        </span>
                    </div>
                    <textarea
                        id="message"
                        value={message}
                        onChange={(e) => setMessage(e.target.value)}
                        placeholder="粘贴或输入顾客的售后消息..."
                        rows={4}
                        maxLength={MAX_MESSAGE_LENGTH}
                        className="w-full resize-none rounded-xl border border-zinc-800 bg-zinc-950/80 px-4 py-3 text-zinc-100 placeholder-zinc-600 transition focus:border-indigo-500/60 focus:outline-none focus:ring-2 focus:ring-indigo-500/30"
                    />

                    <div className="mt-4 flex flex-wrap items-center gap-2">
                        <span className="text-xs text-zinc-600">示例：</span>
                        {EXAMPLE_MESSAGES.map((ex) => (
                            <button
                                key={ex.label}
                                onClick={() => {
                                    setMessage(ex.text);
                                    setResult(null);
                                    setError("");
                                }}
                                className="rounded-full border border-zinc-800 bg-zinc-800/50 px-3 py-1.5 text-xs text-zinc-400 transition hover:border-indigo-500/40 hover:bg-indigo-500/10 hover:text-indigo-300"
                            >
                                {ex.label}
                            </button>
                        ))}
                    </div>

                    <button
                        onClick={handleAnalyze}
                        disabled={loading}
                        className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-indigo-500 to-violet-500 py-3 font-medium text-white shadow-lg shadow-indigo-950/50 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
                    >
                        {loading ? (
                            <>
                                <svg
                                    className="size-4 animate-spin"
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    aria-hidden="true"
                                >
                                    <circle
                                        className="opacity-25"
                                        cx="12"
                                        cy="12"
                                        r="10"
                                        stroke="currentColor"
                                        strokeWidth="3"
                                    />
                                    <path
                                        className="opacity-90"
                                        d="M12 2a10 10 0 0 1 10 10"
                                        stroke="currentColor"
                                        strokeWidth="3"
                                        strokeLinecap="round"
                                    />
                                </svg>
                                Jev 并行评估中…
                            </>
                        ) : (
                            <>
                                <Icon d={ICONS.bolt} className="size-4" />
                                开始分析
                            </>
                        )}
                    </button>

                    {error && (
                        <p className="mt-3 flex items-center justify-center gap-1.5 text-sm text-rose-400">
                            <Icon d={ICONS.alert} className="size-4" />
                            {error}
                        </p>
                    )}
                </section>

                {/* Results */}
                {result && (
                    <section className="space-y-5">
                        {/* Decision Banner */}
                        <div
                            className={`relative overflow-hidden rounded-2xl border bg-gradient-to-br p-6 ${priorityStyle.banner}`}
                        >
                            <div
                                aria-hidden="true"
                                className={`absolute inset-y-0 left-0 w-1 ${priorityStyle.accent}`}
                            />
                            <div className="mb-1 flex items-center gap-2 text-xs text-zinc-400">
                                <Icon d={ICONS.bolt} className="size-3.5" />
                                最终决策建议
                                <span className="rounded-full border border-zinc-700/60 bg-zinc-900/60 px-2 py-0.5 text-[10px] text-zinc-500">
                                    {RULE_LABELS[result.decision.rule]}
                                </span>
                            </div>
                            <div className="mb-3 text-2xl font-semibold leading-snug">
                                {result.decision.final}
                            </div>
                            <div className="mb-3 flex flex-wrap gap-2 text-xs">
                                <span
                                    className={`rounded-full border px-3 py-1 ${priorityStyle.chip}`}
                                >
                                    优先级：{result.decision.priority}
                                </span>
                                <span className="rounded-full border border-zinc-700/60 bg-zinc-800/40 px-3 py-1 text-zinc-300">
                                    路由：
                                    {CATEGORY_LABELS[result.decision.category] ??
                                        result.decision.category}
                                </span>
                            </div>
                            {result.decision.reason && (
                                <p className="border-t border-zinc-800/50 pt-3 text-sm leading-relaxed text-zinc-300">
                                    {result.decision.reason}
                                </p>
                            )}
                        </div>

                        {/* Stats Strip */}
                        <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-5 py-3 text-xs">
                            {result.meta?.latencyMs !== undefined && (
                                <StatItem
                                    icon={ICONS.clock}
                                    label="延迟"
                                    value={`${result.meta.latencyMs} ms`}
                                />
                            )}
                            {result.meta?.usage?.inputTokens !== undefined && (
                                <StatItem
                                    icon={ICONS.cpu}
                                    label="输入"
                                    value={`${result.meta.usage.inputTokens} tok`}
                                />
                            )}
                            {result.meta?.usage?.outputTokens !== undefined && (
                                <StatItem
                                    icon={ICONS.cpu}
                                    label="输出"
                                    value={`${result.meta.usage.outputTokens} tok`}
                                />
                            )}
                            {result.meta?.model && (
                                <StatItem
                                    icon={ICONS.bolt}
                                    label="模型"
                                    value={result.meta.model}
                                />
                            )}
                        </div>
                        {result.meta?.usage && (
                            <p className="-mt-2 text-center text-[11px] text-zinc-600">
                                Jev
                                输出结构化评估结果而非自回归文本，输出几乎不消耗
                                token
                            </p>
                        )}

                        {/* Four Question Cards */}
                        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                            {/* Category - Choice */}
                            <CardShell
                                title="路由分组"
                                icon={ICONS.route}
                                type="choice"
                                footer={
                                    <ConfidenceChip
                                        value={result.confidence?.category}
                                    />
                                }
                            >
                                <div className="mb-3 text-xl font-medium">
                                    {CATEGORY_LABELS[
                                        result.answers.category?.choice ?? ""
                                    ] ??
                                        result.answers.category?.choice ??
                                        "-"}
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
                                                    <span className="w-24 truncate text-zinc-400">
                                                        {CATEGORY_LABELS[key] ??
                                                            key}
                                                    </span>
                                                    <ProbabilityBar
                                                        prob={prob}
                                                        highlight={index === 0}
                                                    />
                                                    <span className="w-12 text-right font-mono text-xs tabular-nums text-zinc-300">
                                                        {formatPercent(prob)}
                                                    </span>
                                                </div>
                                            ))}
                                    </div>
                                )}
                            </CardShell>

                            {/* Urgency - Score */}
                            <CardShell
                                title="紧急程度"
                                icon={ICONS.gauge}
                                type="score"
                                footer={
                                    <ConfidenceChip
                                        value={result.confidence?.urgency}
                                    />
                                }
                            >
                                <div className="mb-1 flex items-baseline gap-2">
                                    <span className="font-mono text-2xl font-medium tabular-nums">
                                        {result.answers.urgency?.score?.toFixed(
                                            2,
                                        ) ?? "-"}
                                    </span>
                                    <span className="text-sm text-zinc-500">
                                        / 3
                                    </span>
                                    <span className="text-sm text-zinc-400">
                                        {URGENCY_LEVELS[
                                            getUrgencyLevel(
                                                result.answers.urgency?.score,
                                            )
                                        ] ?? ""}
                                    </span>
                                </div>
                                <div className="mb-3 mt-2">
                                    <div className="relative h-2 overflow-hidden rounded-full bg-zinc-800/80">
                                        <div
                                            className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-rose-500 transition-all duration-500"
                                            style={{
                                                width: `${Math.min(
                                                    ((result.answers.urgency
                                                        ?.score ?? 0) /
                                                        3) *
                                                        100,
                                                    100,
                                                )}%`,
                                            }}
                                        />
                                    </div>
                                    <div className="mt-1.5 flex justify-between text-[10px] text-zinc-600">
                                        {URGENCY_LEVELS.map((label, i) => (
                                            <span
                                                key={label}
                                                className={
                                                    getUrgencyLevel(
                                                        result.answers.urgency
                                                            ?.score,
                                                    ) === i
                                                        ? "text-zinc-300"
                                                        : ""
                                                }
                                            >
                                                {label}
                                            </span>
                                        ))}
                                    </div>
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
                                                    <span className="w-8 text-xs text-zinc-500">
                                                        Lv{key}
                                                    </span>
                                                    <ProbabilityBar
                                                        prob={prob}
                                                    />
                                                    <span className="w-12 text-right font-mono text-xs tabular-nums text-zinc-300">
                                                        {formatPercent(prob)}
                                                    </span>
                                                </div>
                                            ))}
                                    </div>
                                )}
                            </CardShell>

                            {/* Wants Refund - Boolean */}
                            <CardShell
                                title="是否要求退款"
                                icon={ICONS.refund}
                                type="boolean"
                                footer={
                                    <p className="text-[11px] text-zinc-600">
                                        P(true)：概率越高表示越明确要求退款/退货
                                    </p>
                                }
                            >
                                <BooleanDisplay
                                    probability={
                                        result.answers.wants_refund?.probability
                                    }
                                />
                            </CardShell>

                            {/* Angry - Boolean */}
                            <CardShell
                                title="是否强烈不满"
                                icon={ICONS.alert}
                                type="boolean"
                                footer={
                                    <p className="text-[11px] text-zinc-600">
                                        P(true)：概率越高表示情绪越激烈或有威胁
                                    </p>
                                }
                            >
                                <BooleanDisplay
                                    probability={
                                        result.answers.angry?.probability
                                    }
                                    danger
                                />
                            </CardShell>
                        </div>

                        {/* Raw JSON */}
                        <div className="pt-1 text-center">
                            <button
                                onClick={() => setShowRaw(!showRaw)}
                                className="text-xs text-zinc-500 transition hover:text-zinc-300"
                            >
                                {showRaw
                                    ? "收起原始结构化输出"
                                    : "查看原始结构化输出 (JSON)"}
                            </button>
                        </div>

                        {showRaw && (
                            <pre className="overflow-x-auto rounded-xl border border-zinc-800 bg-zinc-950 p-4 font-mono text-xs leading-relaxed text-zinc-400">
                                {JSON.stringify(result.answers, null, 2)}
                            </pre>
                        )}
                    </section>
                )}

                {/* Footer */}
                <footer className="mt-16 text-center text-xs text-zinc-700">
                    Powered by TypeSafe Jev via Vercel AI Gateway · 仅供演示
                </footer>
            </div>
        </div>
    );
}
