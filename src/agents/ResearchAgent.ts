// @ts-nocheck
import { Agent, callable } from 'agents';

export type Entity = {
    id: string;
    label: string;
    type: 'concept' | 'person' | 'place' | 'event';
    summary: string;
};

export type Relationship = {
    source: string;
    target: string;
    type: string;
};

export type TraceEntry = {
    timestamp: number;
    step: string;
    details: any;
};

export type ResearchProjectState = {
    projectId: string;
    name: string;
    topic: string;
    entities: Entity[];
    relationships: Relationship[];
    notes: Array<string | { content: string }>;
    traces: TraceEntry[];
    nodePositions?: Record<string, { x: number, y: number }>;
};

export interface Env {
    RESEARCH_AGENT: DurableObjectNamespace;
    DEEPDIVE_WORKFLOW: Workflow;
    AI: any;
    VECTORIZE: VectorizeIndex;
}

export class CerebroAgent extends Agent<Env, ResearchProjectState> {

    private getSafeState(): ResearchProjectState {
        return this.state || {
            projectId: "unknown",
            name: "Untitled Project",
            topic: "",
            entities: [],
            relationships: [],
            notes: [],
            traces: [],
            nodePositions: {}
        };
    }

    onStart() {
        if (!this.state || !this.state.name) {
            this.setState(this.getSafeState());
        }
    }

    @callable()
    async initProject(name: string, topic: string) {
        try {
            if (!name) throw new Error("Project name is required");
            console.log(`Initializing project: ${name} with topic: ${topic}`);

            const state: ResearchProjectState = {
                projectId: name.toLowerCase().replace(/\s+/g, '-'),
                name,
                topic: topic || "",
                entities: [{
                    id: 'root',
                    label: name,
                    type: 'concept',
                    summary: topic ? `This research project explores ${topic}. It serves as the central hub from which all related concepts, entities, and discoveries branch out. The topic encompasses various angles and subtopics that will be uncovered through systematic analysis.` : `Research project titled "${name}". This node represents the main focus area for investigation and knowledge synthesis.`
                }],
                relationships: [],
                notes: [],
                traces: [],
            };

            this.setState(state);
            return { status: 'initialized', name, topic };
        } catch (e: any) {
            console.error("Error in initProject:", e);
            throw e;
        }
    }

    @callable()
    async addNote(content: any) {
        try {
            let noteText = '';
            let audioData: Uint8Array | null = null;

            if (content instanceof Uint8Array) {
                audioData = content;
                console.log(`ResearchAgent: Processing binary audio note (${audioData.length} bytes)`);
            } else if (typeof content === 'object' && content !== null && !Array.isArray(content)) {
                // If it's a POJO from JSON.parse (fallback for older clients)
                const values = Object.values(content);
                audioData = new Uint8Array(values as number[]);
                console.log(`ResearchAgent: Processing object-wrapped audio note (${audioData.length} bytes)`);
            }

            if (audioData) {
                try {
                    const response = await this.env.AI.run('@cf/openai/whisper', {
                        audio: Array.from(audioData)
                    });
                    noteText = response.text;
                } catch (e) {
                    console.error("Whisper failed, attempting secondary model or returning raw data error:", e);
                    // No fallback for whisper yet, but we catch it
                    throw new Error("Voice transcription service is temporarily unavailable. Please try typing your note.");
                }
            } else if (typeof content === 'string') {
                noteText = content;
            }

            if (!noteText) throw new Error("Transcription resulted in empty text.");

            const currentState = this.getSafeState();
            this.setState({
                ...currentState,
                notes: [...(currentState.notes || []), noteText]
            });

            try {
                const embedding = await this.generateEmbedding(noteText);
                await this.env.VECTORIZE.upsert([
                    {
                        id: crypto.randomUUID(),
                        values: embedding,
                        metadata: { type: 'note', text: noteText }
                    }
                ]);
            } catch (e) {
                console.warn("Vectorize indexing failed:", e);
            }

            // Automatically trigger discovery after a new note is processed
            await this.startDiscovery();

            return { status: 'note_added', text: noteText };
        } catch (e: any) {
            console.error("Error in addNote:", e);
            throw e;
        }
    }

    @callable()
    async getProjectData() {
        return this.getSafeState();
    }

    @callable()
    async startDiscovery() {
        try {
            const state = this.getSafeState();
            console.log(`Workflow started for project: ${state.name}, topic: ${state.topic}, agent: ${state.projectId}`);

            await this.env.DEEPDIVE_WORKFLOW.create({
                id: `discovery-${state.projectId}-${Date.now()}`,
                params: {
                    projectId: state.projectId,
                    topic: state.topic,
                    agentName: state.projectId,
                    notes: state.notes.map(n => typeof n === 'string' ? n : n.content),
                    existingEntities: state.entities || []
                }
            });

            await this.logTrace('discovery_triggered', { topic: state.topic });
            return { status: 'discovery_initiated' };
        } catch (e: any) {
            console.error("Discovery Error:", e);
            throw e;
        }
    }

    @callable()
    async updateKnowledge(entities: Entity[], relationships: Relationship[]) {
        try {
            const state = this.getSafeState();

            // Merge Entities: if ID exists, update summary; if not, append.
            const updatedEntities = [...state.entities];
            for (const newE of (entities || [])) {
                const idx = updatedEntities.findIndex(e => e.id === newE.id);
                if (idx >= 0) {
                    // Simple append to summary if it doesn't already contain the major part of newE.summary
                    if (!updatedEntities[idx].summary.includes(newE.summary.substring(0, 20))) {
                        updatedEntities[idx] = {
                            ...updatedEntities[idx],
                            summary: updatedEntities[idx].summary + "\n\n" + newE.summary
                        };
                    }
                } else {
                    updatedEntities.push(newE);
                }
            }

            // Merge Relationships (deduplicate)
            const currentRelIds = new Set(state.relationships.map(r => `${r.source}-${r.target}-${r.type}`));
            const newRels = (relationships || []).filter(r => !currentRelIds.has(`${r.source}-${r.target}-${r.type}`));

            this.setState({
                ...state,
                entities: updatedEntities,
                relationships: [...state.relationships, ...newRels]
            });
        } catch (e: any) {
            console.error("Error in updateKnowledge:", e);
            throw e;
        }
    }

    @callable()
    async expandResearch(nodeId: string) {
        try {
            const state = this.getSafeState();
            const entity = state.entities.find(e => e.id === nodeId);
            const topic = entity ? `${entity.label} in context of ${state.topic}` : nodeId;

            await this.logTrace('expansion_triggered', { nodeId, topic });

            await this.env.DEEPDIVE_WORKFLOW.create({
                params: {
                    projectId: state.projectId,
                    topic: topic,
                    agentName: state.projectId,
                    seedNodeId: nodeId
                }
            });
            return { status: 'expansion_initiated', node: nodeId };
        } catch (e: any) {
            console.error("Error in expandResearch:", e);
            throw e;
        }
    }

    @callable()
    async logTrace(step: string, details: any) {
        try {
            const state = this.getSafeState();
            const entry: TraceEntry = {
                timestamp: Date.now(),
                step,
                details
            };
            this.setState({
                ...state,
                traces: [...(state.traces || []), entry].slice(-50)
            });
            return { status: 'trace_logged' };
        } catch (e: any) {
            console.error("Error in logTrace:", e);
            throw e;
        }
    }

    @callable()
    async getTrace() {
        try {
            const state = this.getSafeState();
            return state.traces || [];
        } catch (e: any) {
            console.error("Error in getTrace:", e);
            return [];
        }
    }

    @callable()
    async updateNodePositions(positions: Record<string, { x: number, y: number }>) {
        const state = this.getSafeState();
        this.setState({
            ...state,
            nodePositions: {
                ...(state.nodePositions || {}),
                ...positions
            }
        });
        return { status: 'positions_updated' };
    }

    @callable()
    async deleteEntity(nodeIds: string | string[]) {
        const state = this.getSafeState();
        const toDelete = new Set<string>();
        const ids = Array.isArray(nodeIds) ? nodeIds : [nodeIds];
        ids.forEach(id => toDelete.add(id));

        // Find all descendants recursively for each selected node
        let added = true;
        while (added) {
            added = false;
            for (const rel of state.relationships) {
                if (toDelete.has(rel.source) && !toDelete.has(rel.target)) {
                    toDelete.add(rel.target);
                    added = true;
                }
            }
        }

        // Filter out deleted items
        const newEntities = state.entities.filter(e => !toDelete.has(e.id));
        const newRelationships = state.relationships.filter(
            rel => !toDelete.has(rel.source) && !toDelete.has(rel.target)
        );

        const newNodePositions = { ...state.nodePositions };
        for (const id of toDelete) {
            delete newNodePositions[id];
        }

        this.setState({
            ...state,
            entities: newEntities,
            relationships: newRelationships,
            nodePositions: newNodePositions
        });

        return { status: 'deleted', count: toDelete.size };
    }

    @callable()
    async exploreTopic(nodeId: string, query: string) {
        const state = this.getSafeState();
        const entity = state.entities.find(e => e.id === nodeId);

        if (!entity) return { response: "I couldn't find specific context for this node." };

        const systemPrompt = `You are Cerebro, a research synthesis engine.\nThe user is asking about the node: "${entity.label}".\nCurrent knowledge summary for this node: "${entity.summary}".\n\nProvide a concise answer (2-3 sentences) to the user's question based on this context. If you don't know, briefly suggest what research could be done.\nUser question: "${query}"`;

        const executeLlm = async (prompt: string, attempt: number) => {
            console.log(`Explore Attempt ${attempt}...`);
            const models = [
                '@cf/meta/llama-3.1-8b-instruct',
                '@cf/meta/llama-3-8b-instruct',
                '@cf/meta/llama-2-7b-chat-fp16'
            ];
            const model = models[Math.min(attempt - 1, models.length - 1)];
            
            try {
                const response = await this.env.AI.run(model, {
                    messages: [{ role: 'system', content: prompt }],
                    max_tokens: 250
                });
                // @ts-ignore
                return response.response || response.text;
            } catch (err) {
                console.error(`Explore failed on ${model}:`, err);
                throw err;
            }
        };

        try {
            let resultText = '';
            for (let i = 1; i <= 3; i++) {
                try {
                    resultText = await executeLlm(systemPrompt, i);
                    if (resultText) break;
                } catch (e) {
                    if (i === 3) throw e;
                }
            }
            return { response: resultText || "Synthesis complete. No further insights at this depth." };
        } catch (e) {
            console.error("Explore Topic Final Failure:", e);
            return { response: "Neural link unstable. Analysis: " + entity.summary };
        }
    }

    @callable()
    async getInitialSuggestion(nodeId: string) {
        const state = this.getSafeState();
        const entity = state.entities.find(e => e.id === nodeId);

        if (!entity) return { suggestions: ["No context available for this node."] };

        const systemPrompt = `You are Cerebro, a high-fidelity intelligence synthesis engine.
Your task is to analyze the node "${entity.label}" and provide 2-5 "Resonance Perspectives".

Resonance Perspectives are distinct, high-impact research directions or "different ways of looking at this topic" specifically tailored to the unique findings of this node.

Node Summary: ${entity.summary}

RULES:
1. Provide exactly 2-5 perspectives.
2. Each perspective should be a concise, provocative, and highly contextual research prompt (1 sentence).
3. Ensure the perspectives are UNIQUE to this node's summary, not generic research advice.
4. Output MUST be a valid JSON object with a single key "suggestions" containing an array of strings.
5. DO NOT include any text before or after the JSON.`;

        const models = [
            '@cf/meta/llama-3.1-8b-instruct',
            '@cf/meta/llama-3-8b-instruct',
            '@cf/meta/llama-2-7b-chat-fp16'
        ];

        let lastResultText = '';
        let lastError: any = null;
        let sawUpstream1031 = false;

        for (let i = 0; i < models.length; i++) {
            const model = models[i];
            console.log(`Resonance Angles Attempt ${i + 1} using model: ${model}...`);
            
            try {
                const response = await this.env.AI.run(model, {
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: i > 0 ? "Your previous attempt failed. Please return ONLY a valid JSON object now." : "Generate resonance angles." }
                    ]
                });
                
                // @ts-ignore
                const resultText = (response.response || response.text || "").trim();
                lastResultText = resultText;

                if (!resultText) throw new Error("Empty response from AI");

                // Accept small wrappers around JSON and parse only the outermost object.
                const start = resultText.indexOf('{');
                const end = resultText.lastIndexOf('}');
                if (start === -1 || end === -1 || end < start) {
                    throw new Error('No JSON object found in response');
                }
                const data = JSON.parse(resultText.slice(start, end + 1));
                const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [String(data.suggestions)];
                return { suggestions: suggestions.slice(0, 5) };

            } catch (err) {
                const errMsg = err instanceof Error ? err.message : String(err);
                console.warn(`Resonance attempt ${i + 1} (${model}) failed: ${errMsg}`);
                lastError = err;
                if (errMsg.includes('1031')) {
                    sawUpstream1031 = true;
                    break;
                }
                // If we have more models, the loop continues to the next one
            }
        }

        if (sawUpstream1031) {
            console.warn('Resonance engine unavailable (1031), returning deterministic fallback suggestions.');
        } else {
            console.error("Resonance engine failed all models", lastError, lastResultText);
        }
        return { suggestions: ["Explore alternative systemic implications", "Analyze cross-domain resonance points", "Synthesize emerging patterns"] };
    }

    private async generateEmbedding(text: string): Promise<number[]> {
        const response = await this.env.AI.run('@cf/baai/bge-large-en-v1.5', { text });
        return response.data[0];
    }
}
