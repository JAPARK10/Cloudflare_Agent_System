import React, { useState, useEffect, useRef, useMemo } from 'react';
import './index.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8787';

interface Entity {
    id: string;
    label: string;
    type: string;
    summary: string;
    suggestions?: string[];
}

interface Relationship {
    source: string;
    target: string;
    type: string;
}

interface ProjectData {
    name: string;
    topic: string;
    entities: Entity[];
    relationships: Relationship[];
    notes: string[];
    nodePositions?: Record<string, { x: number, y: number }>;
}

interface DetailPanelProps {
    node: GraphNode | null;
    entities: Entity[];
    slug: string;
    onExpand: (nodeId: string) => void;
}

interface Note {
    id: number | string;
    type: string;
    content: string;
}

interface GraphNode {
    id: string;
    x: number;
    y: number;
    label: string;
    summary?: string;
    suggestions?: string[];
}

const DetailPanel = ({ node, entities, slug, onExpand }: DetailPanelProps) => {
    const [query, setQuery] = useState('');
    const [messages, setMessages] = useState<{ role: 'user' | 'ai', content: string }[]>([]);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [isExploring, setIsExploring] = useState(false);
    const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const suggestionRequestRef = useRef(0);

    // Reset chat when node changes and fetch initial suggestion
    useEffect(() => {
        setMessages([]);
        setQuery('');
        setSuggestions([]);
        if (node) {
            if (Array.isArray(node.suggestions) && node.suggestions.length > 0) {
                setSuggestions(node.suggestions);
                setMessages([{ role: 'ai', content: "Tap a resonance point to expand the intelligence..." }]);
                setIsLoadingSuggestions(false);
                return;
            }
            const requestId = ++suggestionRequestRef.current;
            fetchInitialSuggestion(node.id, requestId);
        }
    }, [node?.id, slug]);

    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [messages]);

    const fetchInitialSuggestion = async (nodeId: string, requestId: number) => {
        setIsLoadingSuggestions(true);
        try {
            const res = await fetch(`${API_BASE}/project/${slug}/getInitialSuggestion`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nodeId })
            });
            const data = await res.json() as any;
            if (requestId !== suggestionRequestRef.current) return;
            setSuggestions(data.suggestions || (data.suggestion ? [data.suggestion] : []));
            setMessages([{ role: 'ai', content: "Tap a resonance point to expand the intelligence..." }]);
        } catch (e) {
            if (requestId !== suggestionRequestRef.current) return;
            setMessages([{ role: 'ai', content: "Intelligence core linked. System ready for exploration." }]);
        } finally {
            if (requestId === suggestionRequestRef.current) setIsLoadingSuggestions(false);
        }
    };

    if (!node) return (
        <div className="flex flex-col items-center justify-center h-full space-y-4 animate-fade-in">
            <div className="w-12 h-12 rounded-full border border-indigo-500/20 flex items-center justify-center animate-pulse">
                <div className="w-2 h-2 bg-indigo-500 rounded-full shadow-[0_0_15px_rgba(99,102,241,1)]"></div>
            </div>
            <div className="text-slate-500 text-[10px] uppercase font-bold tracking-[0.3em]">
                Targeting Intelligence Node
            </div>
        </div>
    );

    const entity = entities.find(e => e.id === node.id);

    const handleExplore = async (manualQuery?: string) => {
        const userMsg = manualQuery ?? query;
        if (!userMsg.trim() || isExploring) return;
        setQuery('');
        setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
        setIsExploring(true);

        try {
            const res = await fetch(`${API_BASE}/project/${slug}/explore`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nodeId: node.id, query: userMsg })
            });
            const data = await res.json() as any;
            setMessages(prev => [...prev, { role: 'ai', content: data.response || "No data synthesized." }]);
        } catch (e) {
            setMessages(prev => [...prev, { role: 'ai', content: "Exploration link failed." }]);
        } finally {
            setIsExploring(false);
        }
    };

    return (
        <div className="h-full min-h-0 flex flex-col">
            {/* WINDOW CHROME */}
            <div className="flex items-center gap-2 px-5 py-3.5 bg-white/[0.03] border-b border-white/[0.05] flex-shrink-0">
                <div className="w-3 h-3 rounded-full bg-red-500/60 hover:bg-red-500 transition-colors cursor-pointer"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500/60 hover:bg-yellow-500 transition-colors cursor-pointer"></div>
                <div className="w-3 h-3 rounded-full bg-green-500/60 hover:bg-green-500 transition-colors cursor-pointer"></div>
                <span className="ml-auto text-[9px] font-black text-slate-600 uppercase tracking-[0.35em]">Intelligence Detail</span>
            </div>
            {/* PANEL HEADER */}
            <div className="bg-white/[0.02] border-b border-white/5 py-10 px-10">
                <div className="flex flex-col space-y-2 min-w-0">
                    <span className="text-[10px] font-black text-indigo-400 uppercase tracking-[0.4em]">Intelligence Focus</span>
                    <h3 className="text-3xl font-bold text-white tracking-tighter leading-tight" style={{ fontFamily: 'var(--font-heading)' }}>
                        {node.label}
                    </h3>
                </div>
            </div>

            <div className="flex-1 flex flex-col min-h-0">
                <div className="p-10 overflow-y-auto flex-1 min-h-0 space-y-12 scroll-area" ref={scrollRef}>
                    {/* SUMMARY SECTION */}
                    <div className="space-y-8 animate-fade-in shadow-sm">
                        <div className="relative">
                            <h2 className="text-xl font-black text-white uppercase tracking-[0.2em] mb-3 flex items-center gap-4">
                                <span className="w-2 h-2 bg-indigo-500 rounded-full shadow-[0_0_15px_rgba(99,102,241,1)]"></span>
                                Core Analysis
                            </h2>
                            <div className="h-[1px] w-full bg-gradient-to-r from-indigo-500/40 via-transparent to-transparent mb-8"></div>
                        </div>
                        <div className="glass-card p-10 bg-white/[0.01] hover:bg-white/[0.02] border-indigo-500/10 transition-all duration-500 group">
                            <div className="text-[15px] text-slate-200 leading-[1.8] font-medium tracking-wide first-letter:text-3xl first-letter:font-black first-letter:text-indigo-400 first-letter:mr-1">
                                {entity?.summary || "Synthesizing intelligence summary..."}
                            </div>
                        </div>
                    </div>

                    {/* PERSPECTIVES SECTION */}
                    <div className="space-y-8 animate-fade-in shadow-sm">
                        <div className="relative">
                            <h2 className="text-xl font-black text-white uppercase tracking-[0.2em] mb-3 flex items-center gap-4">
                                <span className="w-2 h-2 bg-sky-500 rounded-full shadow-[0_0_15px_rgba(14,165,233,1)]"></span>
                                Resonance Perspectives
                            </h2>
                            <div className="h-[1px] w-full bg-gradient-to-r from-sky-500/40 via-transparent to-transparent mb-8"></div>
                        </div>
                        <div className="glass-card p-10 bg-white/[0.01] hover:bg-white/[0.02] border-sky-500/10 transition-all duration-500 group">
                            <div className="grid grid-cols-1 gap-6">
                                {suggestions.map((s, i) => (
                                    <button
                                        key={i}
                                        onClick={() => handleExplore(s)}
                                        className="group relative flex items-start gap-6 p-5 bg-slate-900/40 border border-white/5 rounded-2xl hover:bg-sky-500/[0.05] hover:border-sky-500/40 transition-all duration-500 text-left active:scale-[0.98]"
                                    >
                                        <div className="mt-1.5 w-4 h-4 rounded-full border border-sky-500/30 flex items-center justify-center flex-shrink-0 group-hover:border-sky-500 transition-colors">
                                            <div className="w-1 h-1 bg-sky-500 rounded-full scale-0 group-hover:scale-100 transition-transform"></div>
                                        </div>
                                        <span className="text-[13px] font-bold text-slate-300 group-hover:text-white transition-colors leading-relaxed">
                                            {s}
                                        </span>
                                    </button>
                                ))}
                                {suggestions.length === 0 && isLoadingSuggestions && (
                                    <div className="text-[11px] text-slate-500 font-medium italic py-4">
                                        Synthesizing research angles...
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>

                    {/* DISCOVERY STREAM (MESSAGES) */}
                    <div className="space-y-6 pr-2">
                        {messages.map((m, i) => (
                            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} animate-fade-in`}>
                                <div className={`max-w-[85%] px-6 py-4 rounded-[2rem] text-[13px] leading-relaxed shadow-xl ${m.role === 'user'
                                    ? 'bg-gradient-to-br from-indigo-600/40 to-indigo-700/40 text-indigo-50 border border-indigo-400/20 rounded-tr-none'
                                    : 'bg-white/[0.03] text-slate-200 border border-white/5 rounded-tl-none'
                                    }`}>
                                    {m.content}
                                </div>
                            </div>
                        ))}
                        {isExploring && (
                            <div className="text-[10px] text-sky-400 font-black uppercase tracking-widest flex items-center gap-4 animate-pulse px-2">
                                <div className="flex gap-1.5">
                                    <div className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce"></div>
                                    <div className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
                                    <div className="w-1.5 h-1.5 bg-sky-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
                                </div>
                                Synthesizing Knowledge...
                            </div>
                        )}
                    </div>
                </div>

                {/* INPUT ZONE */}
                <div className="p-10 bg-black/30 border-t border-white/5 backdrop-blur-[60px]">
                    <div className="flex gap-4 mb-6">
                        <input
                            type="text"
                            placeholder="Interrogate Cerebro..."
                            className="search-input flex-1 h-14"
                            value={query}
                            onChange={(e) => setQuery(e.target.value)}
                            onKeyDown={(e) => e.key === 'Enter' && handleExplore()}
                        />
                        <button
                            onClick={() => handleExplore()}
                            className="btn-primary w-24 h-14"
                        >
                            <span className="text-[10px]">Send</span>
                        </button>
                    </div>

                    <button
                        onClick={() => onExpand(node.id)}
                        className="btn-glass w-full h-14 flex items-center justify-center gap-4 group"
                    >
                        <span className="text-lg group-hover:rotate-12 transition-transform">⚡</span> 
                        <span className="text-[11px] font-black tracking-[0.2em]">Scale Discovery Cycle</span>
                    </button>
                </div>
            </div>
        </div>
    );
};



export default function CerebroDashboard() {
    const [projects, setProjects] = useState<string[]>([]);
    const [activeSlug, setActiveSlug] = useState<string>('');

    const [nodes, setNodes] = useState<GraphNode[]>([]);
    const [notes, setNotes] = useState<Note[]>([]);
    const [status, setStatus] = useState<string>('SYSTEM STANDBY');
    const [isRecording, setIsRecording] = useState(false);
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [zoom, setZoom] = useState(1);
    const [deleteConfirm, setDeleteConfirm] = useState<{ x: number; y: number; nodeIds: string[] } | null>(null);
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [entities, setEntities] = useState<Entity[]>([]);
    const [relationships, setRelationships] = useState<Relationship[]>([]);
    const [projectSearch, setProjectSearch] = useState('');
    const [feedSearch, setFeedSearch] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
    const svgRef = useRef<SVGSVGElement>(null);
    const mainRef = useRef<HTMLElement>(null);

    // Track dimensions for centering
    useEffect(() => {
        const update = () => {
            if (mainRef.current) {
                setDimensions({
                    width: mainRef.current.clientWidth,
                    height: mainRef.current.clientHeight
                });
            }
        };
        update();
        window.addEventListener('resize', update);
        return () => window.removeEventListener('resize', update);
    }, []);

    const mediaRecorder = useRef<MediaRecorder | null>(null);
    const audioChunks = useRef<Blob[]>([]);

    const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null);
    const draggingNodesRef = useRef<Set<string>>(new Set());
    const dragStartRef = useRef<{ x: number; y: number } | null>(null);
    const dragStartPositions = useRef<Map<string, { x: number; y: number }>>(new Map());

    const clampZoom = (value: number) => Math.min(5.0, Math.max(0.5, value));
    const handleZoomChange = (newZoom: number) => setZoom(clampZoom(newZoom));

    const clearSelection = () => {
        setSelectedNodeId(null);
        setSelectedNodeIds(new Set());
    };

    const switchActiveProject = (slug: string) => {
        setActiveSlug(slug);
        setSelectedNodeId('root');
        setSelectedNodeIds(new Set(['root']));
        setNodes([]);
        setEntities([]);
        setRelationships([]);
        setNotes([]);
        setDeleteConfirm(null);
    };

    // Compute the path from selected node to root
    const pathToRoot = useMemo(() => {
        if (!selectedNodeId || selectedNodeId === 'root') return new Set(['root']);
        
        const path = new Set<string>(['root']);
        let current = selectedNodeId;
        const visited = new Set<string>([current]);
        
        while (current && current !== 'root') {
            // Find the parent of the current node (relationship where current is target)
            const parentRel = relationships.find(rel => rel.target === current);
            if (!parentRel) break;
            
            const parent = parentRel.source;
            if (visited.has(parent)) break; // Prevent infinite loops
            
            path.add(parent);
            visited.add(parent);
            current = parent;
        }
        
        return path;
    }, [selectedNodeId, relationships]);

    // Initialize projects list from localStorage
    useEffect(() => {
        const saved = window.localStorage.getItem('cerebro_projects');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setProjects(parsed.map((p: any) => p.slug));
                if (parsed.length > 0) switchActiveProject(parsed[0].slug);
            } catch (e) {
                console.error("Failed to parse projects", e);
            }
        }
    }, []);

    const fetchState = async (showLoading = false) => {
        if (!activeSlug) return;
        if (showLoading) setIsLoading(true);
        try {
            const res = await fetch(`${API_BASE}/project/${activeSlug}/getProjectData`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!res.ok) return;

            const data = await res.json() as ProjectData;
            if (data && data.name) {
                setEntities(data.entities);
                setRelationships(data.relationships || []);
                const formattedNotes: Note[] = (data.notes || []).map((n, i) => ({
                    id: `note-${i}`,
                    type: 'KNOWLEDGE',
                    content: n
                }));

                setNotes(formattedNotes.reverse());
                setNodes((prevNodes: GraphNode[]) => {
                    const positionMap = new Map(prevNodes.map((n: GraphNode) => [n.id, { x: n.x, y: n.y }]));

                    // Merge backend positions
                    if (data.nodePositions) {
                        Object.entries(data.nodePositions).forEach(([id, pos]) => {
                            positionMap.set(id, pos as { x: number; y: number });
                        });
                    }

                    const seeded = (s: string) => {
                        let h = 0;
                        for (let i = 0; i < s.length; i++) {
                            h = (31 * h + s.charCodeAt(i)) % 100000;
                        }
                        return (h % 1000) / 1000;
                    };

                    // Build adjacency and BFS depths from the freshly fetched data,
                    // so parent depths are always accurate regardless of React state timing.
                    const adjacency = new Map<string, string[]>();
                    data.relationships.forEach(rel => {
                        if (!adjacency.has(rel.source)) adjacency.set(rel.source, []);
                        adjacency.get(rel.source)!.push(rel.target);
                    });

                    const localDepths = new Map<string, number>();
                    localDepths.set('root', 0);
                    const bfsQ: string[] = ['root'];
                    while (bfsQ.length) {
                        const cur = bfsQ.shift()!;
                        const d = localDepths.get(cur) ?? 0;
                        for (const child of adjacency.get(cur) || []) {
                            if (!localDepths.has(child)) {
                                localDepths.set(child, d + 1);
                                bfsQ.push(child);
                            }
                        }
                    }

                    const newNodes = data.entities.map((e, idx) => {
                        const pos = positionMap.get(e.id);
                        if (pos) return { id: e.id, label: e.label, summary: e.summary, suggestions: e.suggestions, ...pos };

                        if (e.id === 'root') return { id: 'root', label: e.label, summary: e.summary, suggestions: e.suggestions, x: 400, y: 300 };

                        // Find parent of this node
                        let parentId: string | null = null;
                        for (const [source, targets] of adjacency) {
                            if (targets.includes(e.id)) { parentId = source; break; }
                        }

                        if (!parentId) {
                            const angle = (idx / data.entities.length) * 2 * Math.PI;
                            return { id: e.id, label: e.label, summary: e.summary, suggestions: e.suggestions, x: 400 + Math.cos(angle) * 200, y: 300 + Math.sin(angle) * 200 };
                        }

                        const parentPos = { ...(positionMap.get(parentId) || { x: 400, y: 300 }) };

                        // Get siblings (other children of the same parent)
                        const siblings = adjacency.get(parentId) || [];
                        const siblingIndex = siblings.indexOf(e.id);

                        // Placement distance proportional to the parent's visual radius:
                        // root (depth 0) radius=12 → childRadius 216px
                        // depth 1 radius=8.4 → childRadius ~151px
                        // depth 2 radius=5.9 → childRadius ~106px  etc.
                        const parentDepth = localDepths.get(parentId) ?? 0;
                        const parentRadius = Math.max(4, 12 * Math.pow(0.64, parentDepth));
                        const childRadius = parentRadius * 18;

                        const angleStep = (2 * Math.PI) / Math.max(siblings.length, 1);
                        const baseAngle = siblingIndex * angleStep;
                        const angleJitter = (seeded(e.id + 'aj') - 0.5) * (Math.PI / 3); // ±30°
                        const radiusJitter = 1 + (seeded(e.id + 'rj') - 0.5) * 0.25;    // ±12.5%
                        const angle = baseAngle + angleJitter;

                        return {
                            id: e.id,
                            label: e.label,
                            summary: e.summary,
                            suggestions: e.suggestions,
                            x: parentPos.x + Math.cos(angle) * childRadius * radiusJitter,
                            y: parentPos.y + Math.sin(angle) * childRadius * radiusJitter
                        };
                    });

                    return newNodes;
                });
            }
        } catch (e) {
            console.warn("Poll failed for", activeSlug);
        } finally {
            if (showLoading) setIsLoading(false);
        }
    };

    // Correct Initial Selection Logic: ONLY if nothing is selected yet
    useEffect(() => {
        if (!selectedNodeId && nodes.length > 0) {
            const root = nodes.find(n => n.id === 'root');
            if (root) {
                setSelectedNodeId('root');
                setSelectedNodeIds(new Set(['root']));
            }
        }
    }, [nodes.length, activeSlug]);

    useEffect(() => {
        if (!activeSlug) return;

        fetchState(true); // Immediate fetch on activeSlug change
        const interval = setInterval(() => {
            // Only poll if NOT dragging to avoid state conflicts
            if (!draggingNodeId) fetchState(false);
        }, 5000); // Pulse slightly slower to reduce overhead
        return () => clearInterval(interval);
    }, [activeSlug]); // Removed draggingNodeId to prevent flashing on selection/drag start

    const center = { x: dimensions.width / 2, y: dimensions.height / 2 };

    const getDisplayPos = (node: GraphNode) => {
        return {
            x: node.x,
            y: node.y
        };
    };

    const nodeDepths = useMemo(() => {
        const depthMap = new Map<string, number>();
        depthMap.set('root', 0);

        const adjacency = new Map<string, string[]>();
        relationships.forEach(rel => {
            const from = rel.source;
            const to = rel.target;
            if (!adjacency.has(from)) adjacency.set(from, []);
            adjacency.get(from)!.push(to);
        });

        const queue: string[] = ['root'];
        while (queue.length) {
            const current = queue.shift()!;
            const currentDepth = depthMap.get(current) ?? 0;
            const children = adjacency.get(current) || [];
            for (const child of children) {
                if (!depthMap.has(child) || depthMap.get(child)! > currentDepth + 1) {
                    depthMap.set(child, currentDepth + 1);
                    queue.push(child);
                }
            }
        }

        return depthMap;
    }, [relationships]);

    const getNodeRadius = (nodeId: string) => {
        const depth = nodeDepths.get(nodeId) ?? 1;
        const base = 12;
        return Math.max(4, base * Math.pow(0.64, depth));
    };

    const collectDescendants = (startIds: Set<string>) => {
        const collected = new Set(startIds);
        let added = true;
        while (added) {
            added = false;
            relationships.forEach(rel => {
                if (collected.has(rel.source) && !collected.has(rel.target)) {
                    collected.add(rel.target);
                    added = true;
                }
            });
        }
        return collected;
    };

    const handleNodeClick = (nodeId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setSelectedNodeId(nodeId);
        setSelectedNodeIds(new Set([nodeId]));
    };

    const handleBackgroundMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        clearSelection();
        setIsPanning(true);
        dragStartRef.current = { x: e.clientX, y: e.clientY };
    };

    const startNodeDrag = (e: React.MouseEvent, nodeId: string) => {
        e.stopPropagation();
        setIsPanning(false); // Disable panning when starting node drag
        const nodeIsSelected = selectedNodeIds.has(nodeId);
        const baseSelection = nodeIsSelected && selectedNodeIds.size > 1
            ? new Set(selectedNodeIds)
            : new Set([nodeId]);

        const nodesToDrag = collectDescendants(baseSelection);
        draggingNodesRef.current = nodesToDrag;
        setDraggingNodeId(nodeId);
        dragStartRef.current = { x: e.clientX, y: e.clientY };

        const positions = new Map<string, { x: number; y: number }>();
        nodesToDrag.forEach(id => {
            const n = nodes.find(n => n.id === id);
            if (n) positions.set(id, { x: n.x, y: n.y });
        });
        dragStartPositions.current = positions;
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!dragStartRef.current) return;

        const dxScreen = e.clientX - dragStartRef.current.x;
        const dyScreen = e.clientY - dragStartRef.current.y;

        if (isPanning) {
            setPan(prev => ({
                x: prev.x + dxScreen,
                y: prev.y + dyScreen
            }));
            dragStartRef.current = { x: e.clientX, y: e.clientY };
            return;
        }

        if (!draggingNodeId) return;

        const dx = dxScreen / zoom;
        const dy = dyScreen / zoom;

        setNodes(prev => prev.map(n => {
            if (!draggingNodesRef.current.has(n.id)) return n;
            const start = dragStartPositions.current.get(n.id);
            if (!start) return n;
            return { ...n, x: start.x + dx, y: start.y + dy };
        }));
    };

    const persistNodePositions = async (updatedNodes: GraphNode[]) => {
        const positions: Record<string, { x: number, y: number }> = {};
        updatedNodes.forEach(n => {
            positions[n.id] = { x: Math.round(n.x), y: Math.round(n.y) };
        });
        try {
            await fetch(`${API_BASE}/project/${activeSlug}/updatePositions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(positions)
            });
        } catch (e) {
            console.warn("Failed to save positions");
        }
    };

    const handleMouseUp = async () => {
        if (draggingNodeId) {
            await persistNodePositions(nodes);
        }

        setDraggingNodeId(null);
        setIsPanning(false);
        draggingNodesRef.current.clear();
        dragStartRef.current = null;
        dragStartPositions.current.clear();
    };

    const createNewProject = () => {
        const topic = prompt("Enter research topic:");
        if (!topic) return;
        const slug = topic.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');

        fetch(`${API_BASE}/project/${slug}/create`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: topic, topic })
        }).then(res => {
            if (res.ok) {
                const newProjects = [...projects, slug];
                setProjects(newProjects);
                switchActiveProject(slug);
                window.localStorage.setItem('cerebro_projects', JSON.stringify(newProjects.map(s => ({ slug: s }))));
            }
        });
    };

    const deleteProject = (slug: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (!confirm(`Delete research project "${slug}"?`)) return;

        const newProjects = projects.filter(p => p !== slug);
        setProjects(newProjects);
        window.localStorage.setItem('cerebro_projects', JSON.stringify(newProjects.map(s => ({ slug: s }))));
        if (activeSlug === slug) {
            if (newProjects[0]) {
                switchActiveProject(newProjects[0]);
            } else {
                setActiveSlug('');
                // No projects left, clear the map
                setNodes([]);
                setEntities([]);
                setRelationships([]);
                setNotes([]);
                setSelectedNodeId(null);
                setSelectedNodeIds(new Set());
                setDeleteConfirm(null);
            }
        }
    };

    const openDeleteConfirm = (nodeIds: string[]) => {
        setDeleteConfirm({ x: 0, y: 0, nodeIds });
    };

    const requestDeleteNodes = (nodeIds: string[], e: React.MouseEvent<HTMLButtonElement>) => {
        e.preventDefault();
        e.stopPropagation();
        openDeleteConfirm(nodeIds);
    };

    const confirmDelete = async () => {
        if (!deleteConfirm) return;
        const nodeIds = deleteConfirm.nodeIds;
        setDeleteConfirm(null);
        setStatus(`Deleting ${nodeIds.length} node(s)...`);

        try {
            await fetch(`${API_BASE}/project/${activeSlug}/deleteEntity`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nodeIds })
            });

            setSelectedNodeIds(new Set());
            setSelectedNodeId(null);
            await fetchState(true);
            setStatus('Node(s) removed');
        } catch (e) {
            setStatus('Deletion failed');
        }
    };

    const handleExpandResearch = async (nodeId: string) => {
        setStatus(`Expanding node: ${nodeId}...`);
        try {
            const res = await fetch(`${API_BASE}/project/${activeSlug}/expandResearch`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ nodeId })
            });
            if (res.ok) setStatus(`Expansion cycle triggered for ${nodeId}`);
        } catch (e) {
            setStatus("Expansion failed");
        }
    };

    const startRecording = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaRecorder.current = new MediaRecorder(stream);
            audioChunks.current = [];

            mediaRecorder.current.ondataavailable = (e: BlobEvent) => {
                if (e.data.size > 0) audioChunks.current.push(e.data);
            };

            mediaRecorder.current.onstop = async () => {
                const audioBlob = new Blob(audioChunks.current, { type: 'audio/webm' });
                setStatus("Transcribing knowledge...");

                try {
                    const res = await fetch(`${API_BASE}/project/${activeSlug}/voice`, {
                        method: 'POST',
                        body: audioBlob // Send raw binary blob
                    });

                    if (res.ok) setStatus("Knowledge synthesized");
                    else setStatus("Synthesis failed");
                } catch (e) {
                    setStatus("Mic/Network Error");
                }
                stream.getTracks().forEach(track => track.stop());
            };

            mediaRecorder.current.start();
            setIsRecording(true);
            setStatus("Listening...");
        } catch (err) {
            console.error("Mic access denied", err);
        }
    };

    const stopRecording = () => {
        if (mediaRecorder.current && isRecording) {
            mediaRecorder.current.stop();
            setIsRecording(false);
        }
    };

    const selectedNode: GraphNode | null = nodes.find(n => n.id === selectedNodeId) ?? null;
    const selectedNodeDeleteAnchor = selectedNode && selectedNode.id !== 'root' && mainRef.current
        ? (() => {
            const radius = getNodeRadius(selectedNode.id);
            const mainRect = mainRef.current.getBoundingClientRect();
            const localX = center.x + pan.x + zoom * (selectedNode.x - 400 + radius + 18);
            const localY = center.y + pan.y + zoom * (selectedNode.y - 300 + 28);
            return {
                localX,
                localY,
                viewportX: mainRect.left + localX,
                viewportY: mainRect.top + localY
            };
        })()
        : null;
    const isDeleteConfirmingSelected = !!(selectedNode && deleteConfirm && deleteConfirm.nodeIds.length === 1 && deleteConfirm.nodeIds[0] === selectedNode.id);
    const selectedDeleteAffectedSet = isDeleteConfirmingSelected ? collectDescendants(new Set(deleteConfirm.nodeIds)) : new Set<string>();
    const selectedDeleteDownstreamCount = isDeleteConfirmingSelected ? selectedDeleteAffectedSet.size - deleteConfirm.nodeIds.length : 0;
    const deleteCardWidth = 248;
    const deleteCardHeight = selectedDeleteDownstreamCount > 0 ? 140 : 122;
    const selectedDeleteCardPosition = selectedNodeDeleteAnchor
        ? {
            left: Math.max(12, Math.min(selectedNodeDeleteAnchor.localX + 26, dimensions.width - deleteCardWidth - 12)),
            top: Math.max(12, Math.min(selectedNodeDeleteAnchor.localY - deleteCardHeight / 2, dimensions.height - deleteCardHeight - 12))
        }
        : null;

    const filteredProjects = projects.filter(p => p.toLowerCase().includes(projectSearch.toLowerCase()));
    const filteredNotes = notes.filter(n => {
        const content = typeof n === 'string' ? n : n.content;
        return content.toLowerCase().includes(feedSearch.toLowerCase());
    });

    return (
        <div className="dashboard">
            <div className="left-column">                <aside className="panel archive-container glass animate-fade-in">
                    <div className="panel-header py-6 px-8">
                        <div className="flex flex-col">
                            <span className="text-[9px] font-black text-indigo-400 uppercase tracking-[0.4em] mb-1">Vault</span>
                            <span className="panel-title text-2xl tracking-tighter" style={{ fontFamily: 'var(--font-heading)' }}>Archive</span>
                        </div>
                        <button
                            onClick={createNewProject}
                            className="w-12 h-12 flex items-center justify-center rounded-2xl bg-indigo-500/10 border border-white/5 text-indigo-400 hover:bg-indigo-500 hover:text-white transition-all shadow-xl active:scale-90 group"
                        >
                            <span className="text-3xl font-light group-hover:rotate-90 transition-transform">+</span>
                        </button>
                    </div>
                    <div className="px-8 pb-8">
                        <input
                            type="text"
                            className="search-input h-12"
                            placeholder="Interrogate archives..."
                            value={projectSearch}
                            onChange={(e) => setProjectSearch(e.target.value)}
                        />
                    </div>
                    <div className="scroll-area px-8 pb-8 space-y-3">
                        {filteredProjects.length === 0 && <div className="p-10 text-slate-500 text-[11px] font-black uppercase tracking-widest text-center italic opacity-40">No entries synthesized</div>}
                        {filteredProjects.map(p => (
                            <div
                                key={p}
                                className={`project-item group flex justify-between items-center p-4 rounded-xl border border-transparent transition-all cursor-pointer ${activeSlug === p ? 'bg-indigo-600/10 border-indigo-500/20 active shadow-lg' : 'hover:bg-white/[0.03] hover:border-white/5'}`}
                                onClick={() => switchActiveProject(p)}
                            >
                                <div className="flex items-center gap-4">
                                    <div className={`w-1 h-1 rounded-full ${activeSlug === p ? 'bg-indigo-500 shadow-[0_0_8px_rgba(99,102,241,1)]' : 'bg-slate-600'}`}></div>
                                    <div className="text-[13px] font-bold text-slate-200 tracking-wide uppercase">{p}</div>
                                </div>
                                <button
                                    onClick={(e) => deleteProject(p, e)}
                                    className="opacity-0 group-hover:opacity-100 w-8 h-8 flex items-center justify-center rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500 hover:text-white transition-all shadow-sm active:scale-90"
                                >
                                    <span className="text-[10px]">✕</span>
                                </button>
                            </div>
                        ))}
                    </div>
                </aside>

                <aside className="panel feed-container glass animate-fade-in [animation-delay:0.1s]">
                    <div className="panel-header py-6 px-8">
                        <div className="flex flex-col">
                            <span className="text-[9px] font-black text-sky-400 uppercase tracking-[0.4em] mb-1">Streams</span>
                            <span className="panel-title text-2xl tracking-tighter" style={{ fontFamily: 'var(--font-heading)' }}>Knowledge Feed</span>
                        </div>
                    </div>
                    <div className="px-8 pb-8">
                        <input
                            type="text"
                            className="search-input h-12"
                            placeholder="Filter knowledge..."
                            value={feedSearch}
                            onChange={(e) => setFeedSearch(e.target.value)}
                        />
                    </div>
                    <div className="scroll-area px-8 pb-4 space-y-6">
                        {filteredNotes.map((note, idx) => (
                            <div key={idx} className="note-card bg-white/[0.02] border border-white/5 p-6 rounded-2xl animate-fade-in hover:border-sky-500/30 transition-all group">
                                <div className="text-[9px] font-black text-sky-500 uppercase tracking-[0.3em] mb-4 flex items-center gap-3">
                                    <div className="w-1.5 h-1.5 bg-sky-500 rounded-full shadow-[0_0_10px_rgba(56,189,248,0.8)] group-hover:animate-ping"></div>
                                    Insight Synthesis
                                </div>
                                <div className="text-[12px] text-slate-200 leading-relaxed font-medium tracking-wide">{typeof note === 'string' ? note : note.content}</div>
                            </div>
                        ))}
                    </div>
                    <div className="py-5 px-8 border-t border-white/5 bg-white/[0.01]">
                        <button
                            onClick={isRecording ? stopRecording : startRecording}
                            className={`btn-voice-insight ${isRecording ? 'recording' : ''}`}
                        >
                            <div className={`w-3 h-3 rounded-full ${isRecording ? 'bg-white animate-pulse' : 'bg-indigo-500'} shadow-[0_0_10px_rgba(99,102,241,0.5)]`}></div>
                            {isRecording ? 'Finalizing Synthesis...' : 'Neural Voice Insight'}
                        </button>
                    </div>
                </aside>
            </div>

            <main
                ref={mainRef}
                className="graph-container bg-gradient-to-br from-[#0a0a14] to-[#0d0d1a] shadow-2xl"
                onWheel={(e) => {
                    const delta = -e.deltaY * 0.001;
                    handleZoomChange(zoom + delta);
                }}
            >
                <svg
                    ref={svgRef}
                    width="100%"
                    height="100%"
                    className="w-full h-full cursor-grab active:cursor-grabbing overflow-visible"
                    onMouseDown={handleBackgroundMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                >
                    <defs>
                        <radialGradient id="nodeGradient" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
                            <stop offset="0%" stopColor="var(--accent-primary)" stopOpacity="0.4" />
                            <stop offset="100%" stopColor="var(--accent-primary)" stopOpacity="0" />
                        </radialGradient>
                    </defs>

                    <g transform={`translate(${center.x + pan.x}, ${center.y + pan.y}) scale(${zoom}) translate(-400, -300)`}>

                    {!isLoading && relationships.map((rel) => {
                        const source = nodes.find(n => n.id === rel.source);
                        const target = nodes.find(n => n.id === rel.target);
                        if (!source || !target) return null;
                        const p1 = getDisplayPos(source);
                        const p2 = getDisplayPos(target);
                        
                        // Highlight edges where either endpoint is selected, OR edges on the path to root
                        const isDirectlyConnected = (selectedNodeId === rel.source || selectedNodeId === rel.target) || 
                                                   (selectedNodeIds.has(rel.source) || selectedNodeIds.has(rel.target));
                        const isOnPathToRoot = pathToRoot.has(rel.source) && pathToRoot.has(rel.target);
                        const isEdgeHighlighted = isDirectlyConnected || isOnPathToRoot;

                        return (
                            <line
                                key={`${rel.source}-${rel.target}`}
                                x1={p1.x} y1={p1.y}
                                x2={p2.x} y2={p2.y}
                                className={`edge ${isEdgeHighlighted ? 'highlighted' : ''}`}
                                style={{ 
                                    strokeWidth: isEdgeHighlighted ? 2.5 : 1.5,
                                    stroke: isEdgeHighlighted ? 'var(--accent-primary)' : undefined,
                                    opacity: isEdgeHighlighted ? 0.6 : 0.15,
                                    transition: 'all 0.3s ease-out'
                                }}
                            />
                        );
                    })}

                    {!isLoading && nodes.map((n) => {
                        const display = getDisplayPos(n);
                        const baseRadius = getNodeRadius(n.id);
                        const radius = baseRadius; // Scaling handled by g transform
                        const isSelected = selectedNodeIds.has(n.id) || selectedNodeId === n.id;

                        return (
                            <g
                                key={n.id}
                                transform={`translate(${display.x}, ${display.y})`}
                                className="node-group"
                            >
                                {/* Glow layer */}
                                <circle
                                    r={radius * 2.5}
                                    fill="url(#nodeGradient)"
                                    opacity={isSelected ? 1 : 0.4}
                                    style={{ pointerEvents: 'none', transition: 'r 0.3s ease-out' }}
                                />
                                
                                <circle
                                    r={radius}
                                    className={`node-circle ${isSelected ? 'selected' : ''}`}
                                    onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        handleNodeClick(n.id, e);
                                    }}
                                    onMouseDown={(e) => {
                                        e.stopPropagation();
                                        // Update selection immediately on mouse down for responsiveness
                                        if (!selectedNodeIds.has(n.id)) {
                                            handleNodeClick(n.id, e);
                                        }
                                        // startNodeDrag(e, n.id); // Removed to restrict dragging to handle
                                    }}
                                    style={{ cursor: 'pointer' }}
                                />

                                <text
                                    dy={-radius - 12}
                                    textAnchor="middle"
                                    className="node-label"
                                    style={{ 
                                        pointerEvents: 'none',
                                        fontSize: `${Math.max(8, baseRadius * 0.9)}px`,
                                        paintOrder: 'stroke',
                                        stroke: 'rgba(0,0,0,0.8)',
                                        strokeWidth: '2px',
                                        strokeLinecap: 'round',
                                        strokeLinejoin: 'round',
                                        transition: 'all 0.3s ease-out'
                                    }}
                                >
                                    {n.label}
                                </text>

                                {isSelected && (
                                    <g
                                        className="node-controls active"
                                        transform={`translate(${radius + 12}, -12)`}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <g
                                            className="control-btn drag-btn group cursor-move"
                                            onMouseDown={(e) => startNodeDrag(e, n.id)}
                                        >
                                            <circle r={14} fill="rgba(15,23,42,0.95)" stroke="rgba(255,255,255,0.15)" className="shadow-premium" />
                                            <text x="0" y={4} textAnchor="middle" fontSize={12} fill="var(--accent-primary)" style={{ pointerEvents: 'none' }}>✥</text>
                                        </g>

                                    </g>
                                )}
                            </g>
                        );
                    })}
                    </g>
                </svg>

                {selectedNodeDeleteAnchor && (
                    isDeleteConfirmingSelected && selectedDeleteCardPosition ? (
                        <div
                            style={{
                                position: 'absolute',
                                left: selectedDeleteCardPosition.left,
                                top: selectedDeleteCardPosition.top,
                                width: `${deleteCardWidth}px`,
                                minHeight: `${deleteCardHeight}px`,
                                borderRadius: '18px',
                                border: '1px solid rgba(248, 113, 113, 0.35)',
                                background: 'rgba(15, 23, 42, 0.98)',
                                boxShadow: '0 18px 42px rgba(0, 0, 0, 0.45)',
                                zIndex: 145,
                                pointerEvents: 'auto',
                                overflow: 'hidden'
                            }}
                            onMouseDown={(e) => e.stopPropagation()}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div style={{ height: '2px', width: '100%', background: 'linear-gradient(90deg, rgba(220,38,38,0.95), rgba(248,113,113,0.95), rgba(220,38,38,0.3))' }} />
                            <div className="p-4 flex flex-col gap-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-red-400 text-sm leading-none">⚠</span>
                                    <span className="text-[12px] font-bold text-white">Delete Node</span>
                                </div>
                                <div className="bg-red-950/30 border border-red-500/20 rounded-xl px-3 py-2">
                                    <p className="text-[11px] font-bold text-white truncate">"{selectedNode.label}"</p>
                                    {selectedDeleteDownstreamCount > 0 && (
                                        <p className="text-[10px] text-slate-400 mt-0.5">+{selectedDeleteDownstreamCount} downstream node{selectedDeleteDownstreamCount > 1 ? 's' : ''}</p>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={confirmDelete}
                                        className="flex-1 h-8 bg-red-600/20 hover:bg-red-600 border border-red-500/30 rounded-lg text-[9px] font-black text-red-100 transition-all duration-200 uppercase tracking-[0.15em] active:scale-95"
                                    >
                                        Delete{selectedDeleteDownstreamCount > 0 ? ` all ${selectedDeleteAffectedSet.size}` : ''}
                                    </button>
                                    <button
                                        onClick={() => setDeleteConfirm(null)}
                                        className="flex-1 h-8 bg-white/5 hover:bg-white/10 border border-white/10 rounded-lg text-[9px] font-black text-slate-300 transition-all duration-200 uppercase tracking-[0.15em] active:scale-95"
                                    >
                                        Cancel
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <button
                            type="button"
                            aria-label={`Delete ${selectedNode?.label ?? 'node'}`}
                            onClick={(e) => {
                                if (!selectedNode) return;
                                requestDeleteNodes([selectedNode.id], e);
                            }}
                            style={{
                                position: 'absolute',
                                left: selectedNodeDeleteAnchor.localX,
                                top: selectedNodeDeleteAnchor.localY,
                                transform: 'translate(-50%, -50%)',
                                width: '36px',
                                height: '36px',
                                borderRadius: '9999px',
                                border: '1px solid rgba(248, 113, 113, 0.35)',
                                background: 'rgba(15, 23, 42, 0.98)',
                                color: '#f87171',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: '16px',
                                fontWeight: 900,
                                lineHeight: 1,
                                cursor: 'pointer',
                                boxShadow: '0 12px 28px rgba(0, 0, 0, 0.45)',
                                zIndex: 140,
                                pointerEvents: 'auto'
                            }}
                        >
                            ✕
                        </button>
                    )
                )}

                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-slate-950/60 backdrop-blur-sm z-50">
                        <div className="flex flex-col items-center gap-5">
                            <div className="relative w-16 h-16">
                                <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full"></div>
                                <div className="absolute inset-0 border-4 border-t-indigo-500 rounded-full animate-spin"></div>
                            </div>
                            <div className="text-[11px] font-bold text-indigo-400 uppercase tracking-[0.3em] animate-pulse">Syncing Intelligence</div>
                        </div>
                    </div>
                )}
                <div className="status-bar glass-heavy rounded-3xl h-24 px-10">
                    <div className="status-label-group">
                        <span className="text-indigo-400 font-black uppercase tracking-[0.4em] text-[9px]">Neural Link</span>
                        <div className="flex items-center gap-3">
                            <div className="w-2 h-2 bg-emerald-500 rounded-full shadow-[0_0_12px_rgba(16,185,129,0.8)] animate-pulse"></div>
                            <span className="text-white font-mono text-[11px] uppercase tracking-widest font-bold">{status}</span>
                        </div>
                    </div>

                    <div className="flex items-center gap-8 px-12 border-x border-white/5">
                        <div className="status-label-group">
                            <span className="text-[9px] text-slate-500 font-black uppercase tracking-[0.4em]">Resolvability</span>
                            <div className="flex items-center gap-6">
                                <input
                                    type="range"
                                    min={0.5}
                                    max={5.0}
                                    step={0.05}
                                    value={zoom}
                                    onChange={(e) => handleZoomChange(Number(e.target.value))}
                                    className="w-48"
                                />
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={() => window.open(`/reasoning?project=${activeSlug}`, '_blank')}
                        className="btn-reasoning-hub"
                    >
                        <span className="text-lg">⚡</span> 
                        Neural Reasoning Hub
                    </button>
                </div>
            </main>

            <aside className="detail-panel">
                <DetailPanel
                    node={selectedNode}
                    entities={entities}
                    slug={activeSlug}
                    onExpand={handleExpandResearch}
                />
            </aside>

        </div>
    );
}
