import React, { useState, useEffect, useRef } from 'react';

interface TraceEntry {
    timestamp: number;
    step: string;
    details: any;
}

interface ReasoningViewProps {
    activeSlug: string;
    onBack: () => void;
}

const ReasoningView: React.FC<ReasoningViewProps> = ({ activeSlug, onBack }) => {
    const [traces, setTraces] = useState<TraceEntry[]>([]);
    const [loading, setLoading] = useState(true);
    const scrollRef = useRef<HTMLDivElement>(null);

    const fetchTraces = async () => {
        try {
            const res = await fetch(`http://localhost:8787/project/${activeSlug}/trace`);
            if (res.ok) {
                const data = (await res.json()) as TraceEntry[];
                setTraces(data);
            }
        } catch (e) {
            console.error("Failed to fetch traces:", e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchTraces();
        const interval = setInterval(fetchTraces, 5000);
        return () => clearInterval(interval);
    }, [activeSlug]);


    return (
        <div className="reasoning-container bg-[#050510]">
            <header className="reasoning-header py-12 border-b border-white/5 bg-white/[0.02] backdrop-blur-2xl px-12">
                <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
                    <div className="flex flex-col gap-2">
                        <button onClick={onBack} className="btn-glass self-start h-10 px-6 mb-4 flex items-center gap-3">
                            <span className="text-lg">←</span> 
                            <span className="text-[10px] font-black tracking-widest uppercase">Dashboard</span>
                        </button>
                        <h1 className="text-4xl font-bold text-white tracking-tighter" style={{ fontFamily: 'var(--font-heading)' }}>
                            Neural Reasoning Hub: <span className="text-indigo-400">{activeSlug}</span>
                        </h1>
                    </div>
                    <div className="flex flex-col items-end gap-3">
                        <div className="status-badge bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-6 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.3em] flex items-center gap-3">
                            <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(16,185,129,0.8)]"></div>
                            Live Synthesis Active
                        </div>
                        <span className="text-slate-500 text-[9px] font-black uppercase tracking-[0.4em]">Audit Stream v2.4</span>
                    </div>
                </div>
            </header>

            <div className="max-w-5xl mx-auto w-full py-16 px-12">
                <div className="trace-timeline space-y-16">
                    {traces.length === 0 && !loading && (
                        <div className="glass-card p-20 text-center flex flex-col items-center gap-6">
                            <div className="w-16 h-16 rounded-full border border-white/5 flex items-center justify-center opacity-40">
                                <span className="text-2xl">📡</span>
                            </div>
                            <div className="text-slate-500 text-[11px] font-black uppercase tracking-[0.4em] italic">No neural traces synthesized for this context</div>
                        </div>
                    )}

                    {traces.map((trace, i) => (
                        <div key={i} className={`relative group animate-fade-in [animation-delay:${i * 0.1}s]`}>
                            {/* VERTICAL LINE PIECE */}
                            {i < traces.length - 1 && (
                                <div className="absolute left-[31px] top-16 bottom-[-64px] w-[2px] bg-gradient-to-b from-indigo-500/40 to-transparent"></div>
                            )}

                            <div className="space-y-6">
                                {/* METADATA FRAME */}
                                <div className={`glass-card relative border-l-4 ${trace.step.includes('failure') ? 'border-l-red-500 hover:border-l-red-400' : 'border-l-indigo-500 hover:border-l-indigo-400'} p-8`}>
                                    <div className="trace-meta flex items-center justify-between">
                                        <div className="flex items-center gap-6">
                                            <div className="w-16 h-16 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 font-mono text-sm font-bold shadow-xl">
                                                {String(i + 1).padStart(2, '0')}
                                            </div>
                                            <div className="flex flex-col gap-1">
                                                <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.3em]">Process Stage</span>
                                                <span className="text-lg font-bold text-white tracking-widest">{trace.step.replace(/_/g, ' ').toUpperCase()}</span>
                                            </div>
                                        </div>
                                        <div className="flex flex-col items-end gap-2">
                                            <span className="text-[10px] font-mono text-slate-500 font-bold bg-white/5 px-4 py-1.5 rounded-lg">{new Date(trace.timestamp).toLocaleTimeString()}</span>
                                            {trace.details.attempt && (
                                                <span className="text-[9px] font-black text-indigo-400 uppercase tracking-widest bg-indigo-500/5 px-3 py-1 rounded border border-indigo-500/10">Attempt #{trace.details.attempt}</span>
                                            )}
                                        </div>
                                    </div>
                                </div>

                                {/* DETAIL FRAMES */}
                                <div className="ml-24 space-y-6">
                                    {trace.details.prompt && (
                                        <div className="glass-card p-8 border border-white/5 bg-white/[0.01] hover:bg-white/[0.02]">
                                            <label className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.4em] flex items-center gap-3 mb-6">
                                                <div className="w-1 h-3 bg-indigo-500 rounded-full"></div>
                                                System Directives
                                            </label>
                                            <div className="bg-black/40 border border-white/5 p-8 rounded-2xl font-mono text-[11px] leading-relaxed text-slate-300 shadow-inner overflow-x-auto whitespace-pre-wrap">
                                                {trace.details.prompt}
                                            </div>
                                        </div>
                                    )}

                                    {trace.details.input && (
                                        <div className="glass-card p-8 border border-white/5 bg-sky-500/[0.005] hover:bg-sky-500/[0.01]">
                                            <label className="text-[10px] font-black text-sky-400 uppercase tracking-[0.4em] flex items-center gap-3 mb-6">
                                                <div className="w-1 h-3 bg-sky-500 rounded-full"></div>
                                                Ingested Knowledge
                                            </label>
                                            <div className="bg-black/40 border border-white/5 p-8 rounded-2xl font-mono text-[11px] leading-relaxed text-slate-300 shadow-inner overflow-x-auto whitespace-pre-wrap">
                                                {trace.details.input}
                                            </div>
                                        </div>
                                    )}

                                    {trace.details.output && (
                                        <div className="glass-card p-8 border border-emerald-500/10 bg-emerald-500/[0.01] hover:bg-emerald-500/[0.02]">
                                            <label className="text-[10px] font-black text-emerald-400 uppercase tracking-[0.4em] flex items-center gap-3 mb-6">
                                                <div className="w-1 h-3 bg-emerald-500 rounded-full"></div>
                                                Synthesized Insight
                                            </label>
                                            <div className="bg-emerald-500/[0.02] border border-emerald-500/10 p-8 rounded-2xl font-mono text-[12px] leading-relaxed text-emerald-50/90 shadow-xl whitespace-pre-wrap">
                                                {trace.details.output}
                                            </div>
                                        </div>
                                    )}

                                    {trace.details.error && (
                                        <div className="glass-card p-8 border border-red-500/20 bg-red-500/[0.02] hover:bg-red-500/[0.03]">
                                            <label className="text-[10px] font-black text-red-400 uppercase tracking-[0.4em] mb-6 block">Neural Friction Detected</label>
                                            <div className="text-red-100 font-medium text-[13px] leading-relaxed bg-red-500/5 p-6 rounded-xl border border-red-500/10">{trace.details.error}</div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <style dangerouslySetInnerHTML={{
                __html: `
                .reasoning-container {
                    min-height: 100vh;
                    background: radial-gradient(circle at 50% 0%, #0a0a20 0%, #050510 100%);
                    color: #f8fafc;
                }
                /* Hide global container padding/overflow if needed */
                body { 
                    background: #050510 !important; 
                    overflow-y: auto !important; 
                    height: auto !important; 
                    min-height: 100vh !important;
                }
            `}} />
        </div>
    );
};

export default ReasoningView;
