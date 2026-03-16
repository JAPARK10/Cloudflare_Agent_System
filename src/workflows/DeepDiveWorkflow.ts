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
            const systemPrompt = `You are a research strategist. Break down a complex topic into a maximum of 4 specific, distinct research sub-tasks. 
            CONTEXT FROM USER VOICE NOTES:
            ${notes}
            
            Be highly specific and avoid generic definitions.`;

            const response = await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: `Topic: ${topic}` }
                ],
                max_tokens: 2048
            });

            const rawResponse = response.response;
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
                const systemPrompt = `Extract key entities and relationships.
                STRICT LIMIT: Extract a maximum of 4 high-priority entities.
                EXISTING ENTITIES (Do NOT duplicate these concepts): ${existingEntities}
                
                STRICT RULES:
                1. Return ONLY a raw JSON object. No conversational text. No "Here is the JSON...". No markdown blocks (\`\`\`json).
                2. If you violate rule #1, your output will be rejected.
                3. Do NOT include the main topic "${topic}" as an entity.
                4. IDs must be unique, descriptive, and slugified.
                
                JSON Format:
                { 
                  "entities": [{"id": "string", "label": "string", "type": "concept|person|place|event", "summary": "string"}], 
                   "relationships": [{"source": "string", "target": "string", "type": "string"}] 
                }`;

                let retryPrompt = i > 0
                    ? `YOUR PREVIOUS OUTPUT FAILED PARSING. 
                       ERROR: ${lastError}
                       PREVIOUS OUTPUT: ${lastResponse}
                       FIX IT NOW. REMEMBER: NO MARKDOWN, NO TEXT, ONLY RAW JSON.`
                    : expansion;

                const response = await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
                    messages: [
                        { role: 'system', content: systemPrompt },
                        { role: 'user', content: retryPrompt }
                    ],
                    response_format: { type: 'json_object' },
                    max_tokens: 2048
                });

                const rawResponse = (response.response || "").trim();
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
                    parsed.relationships = (parsed.relationships || []).filter((rel: Relationship) => 
                        parsed.entities.some((e: Entity) => e.id === rel.source || e.id === rel.target) || 
                        rel.source === 'root' || rel.target === 'root'
                    );

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
