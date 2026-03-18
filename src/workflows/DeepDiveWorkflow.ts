import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers';
import { Env, Entity, Relationship } from '../agents/ResearchAgent';

export class DeepDiveWorkflow extends WorkflowEntrypoint<Env, DiscoveryParams> {
    async run(event: WorkflowEvent<DiscoveryParams>, step: WorkflowStep) {
        const { projectId, topic, agentName } = event.payload;
        console.log(`Workflow started for project: ${projectId}, topic: ${topic}, agent: ${agentName}`);

        // Step 1: Broad Topic Expansion
        const expansion = await step.do('expand-topic', async () => {
            console.log(`Step 1: Expanding topic "${topic}"`);
            const notes = event.payload.notes?.join('\n') || '';
            const systemPrompt = `You are a research strategist. Extract a maximum of 4 core points and specific insights from the provided context. 
            CONTEXT FROM USER VOICE NOTES:
            ${notes}
            
            Be highly specific. Each point should be a concise, meaningful statement representing a key takeaway.`;

            const models = [
                '@cf/meta/llama-3.1-8b-instruct',
                '@cf/meta/llama-3-8b-instruct',
                '@cf/meta/llama-2-7b-chat-fp16'
            ];

            let response;
            let lastErr;
            for (const model of models) {
                try {
                    console.log(`Expansion Attempting with model: ${model}`);
                    const result = await this.env.AI.run(model, {
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: `Topic: ${topic}` }
                        ],
                        max_tokens: 2048
                    });
                    // @ts-ignore
                    response = result.response || result.text;
                    if (response) break;
                } catch (err) {
                    console.error(`Expansion failed on ${model}:`, err);
                    lastErr = err;
                }
            }

            if (!response) throw lastErr || new Error("All AI models failed for topic expansion.");

            const rawResponse = response;
            console.log(`Step 1 Response received (${rawResponse.length} chars)`);

            try {
                const agentId = this.env.RESEARCH_AGENT.idFromName(agentName);
                const agentStub = this.env.RESEARCH_AGENT.get(agentId);
                // @ts-ignore
                await agentStub.logTrace('llm_expansion', { prompt: systemPrompt, input: topic, output: rawResponse });
            } catch (e) {
                console.error(`Failed to log trace for Step 1:`, e);
            }

            return rawResponse;
        });

        // Step 2: Entity Extraction & Synthesis
        const discovery = await step.do('discovery-phase', async () => {
            console.log(`Step 2: Extracting entities from expansion`);
            const existingEntities = event.payload.existingEntities?.map(e => e.label).join(', ') || 'None';

            let lastError = "";
            let lastResponse = "";
            const maxRetries = 7;

            for (let i = 0; i < maxRetries; i++) {
                const systemPrompt = `Extract key entities from the provided core points.
                STRICT LIMIT: Extract a maximum of 4 high-priority entities.
                EXISTING ENTITIES (Do NOT duplicate these concepts): ${existingEntities}
                
                STRICT RULES:
                1. Return ONLY a raw JSON object. No conversational text. No markdown blocks (\`\`\`json).
                2. Do NOT include the main topic "${topic}" as an entity.
                3. IDs must be unique, descriptive, and slugified.
                4. The "label" for each entity MUST be the core point text itself (shortened to a meaningful title if needed).
                
                JSON Format:
                { 
                  "entities": [{"id": "string", "label": "string", "type": "concept|person|place|event", "summary": "string"}]
                }`;

                let retryPrompt = i > 0
                    ? `YOUR PREVIOUS OUTPUT FAILED PARSING. 
                       ERROR: ${lastError}
                       PREVIOUS OUTPUT: ${lastResponse}
                       FIX IT NOW. REMEMBER: NO MARKDOWN, NO TEXT, ONLY RAW JSON.`
                    : expansion;

                const models = [
                    '@cf/meta/llama-3.1-8b-instruct',
                    '@cf/meta/llama-3-8b-instruct',
                    '@cf/meta/llama-2-7b-chat-fp16'
                ];
                
                const model = models[Math.min(i, models.length - 1)];
                console.log(`Discovery Attempting with model: ${model}`);

                let result;
                try {
                    result = await this.env.AI.run(model, {
                        messages: [
                            { role: 'system', content: systemPrompt },
                            { role: 'user', content: retryPrompt }
                        ],
                        max_tokens: 2048
                    });
                } catch (err) {
                    console.error(`Discovery attempt ${i + 1} (${model}) failed:`, err);
                    lastError = `AI Service Error: ${err instanceof Error ? err.message : String(err)}`;
                    continue; // Fallback to next model/attempt
                }

                // @ts-ignore
                const rawResponse = (result.response || result.text || "").trim();
                lastResponse = rawResponse;

                try {
                    // Pre-parsing cleanup: Remove markdown blocks if AI ignored the instructions
                    const cleanJson = rawResponse.replace(/```json/g, '').replace(/```/g, '').trim();
                    const parsed = JSON.parse(cleanJson);

                    if (!parsed.entities || !Array.isArray(parsed.entities)) {
                        throw new Error("Missing 'entities' array in response");
                    }

                    // Strict limit enforcement: slice to 4 nodes
                    parsed.entities = (parsed.entities || []).slice(0, 4);
                    // Relationships are now handled strictly by the workflow logic, ignoring any AI-generated ones
                    parsed.relationships = [];

                    // Log successful or final trace
                    const agentId = this.env.RESEARCH_AGENT.idFromName(agentName);
                    const agentStub = this.env.RESEARCH_AGENT.get(agentId);
                    // @ts-ignore
                    await agentStub.logTrace('llm_discovery', {
                        attempt: i + 1,
                        prompt: systemPrompt,
                        input: retryPrompt,
                        output: rawResponse
                    });

                    return parsed;
                } catch (e: any) {
                    console.error(`Attempt ${i + 1} failed: ${e.message}`);
                    lastError = e.message;

                    // Log failure trace
                    try {
                        const agentId = this.env.RESEARCH_AGENT.idFromName(agentName);
                        const agentStub = this.env.RESEARCH_AGENT.get(agentId);
                        // @ts-ignore
                        await agentStub.logTrace('llm_discovery_failure', {
                            attempt: i + 1,
                            error: e.message,
                            output: rawResponse
                        });
                    } catch (traceErr) { }

                    if (i === maxRetries - 1) {
                        return { entities: [], relationships: [] };
                    }
                }
            }
            return { entities: [], relationships: [] };
        });

        // Connect discovery to the anchor node when possible
        if (event.payload.seedNodeId && discovery.entities?.length) {
            const seed = event.payload.seedNodeId;
            const entityIds = new Set((discovery.entities || []).map((e: Entity) => e.id));

            discovery.relationships = discovery.relationships || [];
            for (const entityId of entityIds) {
                if (entityId === seed) continue;
                discovery.relationships.push({ source: seed, target: entityId, type: 'related' });
            }
        } else if (!event.payload.seedNodeId && discovery.entities?.length) {
            // For initial discovery (no seed node), connect all entities to the root
            const entityIds = new Set((discovery.entities || []).map((e: Entity) => e.id));

            discovery.relationships = discovery.relationships || [];
            for (const entityId of entityIds) {
                discovery.relationships.push({ source: 'root', target: entityId, type: 'related' });
            }
        }

        // Step 3: Update Knowledge Brain (Agent)
        await step.do('update-agent-knowledge', async () => {
            console.log(`Step 3: Updating agent ${agentName} with ${discovery.entities?.length || 0} entities`);
            try {
                const agentId = this.env.RESEARCH_AGENT.idFromName(agentName);
                const agentStub = this.env.RESEARCH_AGENT.get(agentId);
                // @ts-ignore
                await agentStub.updateKnowledge(discovery.entities || [], discovery.relationships || []);
            } catch (e) {
                console.error(`Failed to update agent knowledge:`, e);
                throw e;
            }
        });

        // Step 4: Semantic Finalization
        await step.do('index-results', async () => {
            console.log(`Step 4: Vectorizing ${discovery.entities?.length || 0} entities`);
            if (!discovery.entities) return;
            for (const entity of discovery.entities) {
                try {
                    const vector = await this.env.AI.run('@cf/baai/bge-large-en-v1.5', { text: entity.summary });
                    await this.env.VECTORIZE.upsert([{
                        id: entity.id,
                        values: vector.data[0],
                        metadata: { projectId, type: 'entity', label: entity.label }
                    }]);
                } catch (e) {
                    console.warn(`Failed to vectorize entity ${entity.id}:`, e);
                }
            }
        });
    }
}

type DiscoveryParams = {
    projectId: string;
    topic: string;
    agentName: string;
    seedNodeId?: string;
    notes?: string[];
    existingEntities?: Entity[];
};
