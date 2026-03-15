import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { CerebroAgent } from './agents/ResearchAgent';
import { DeepDiveWorkflow } from './workflows/DeepDiveWorkflow';

const app = new Hono<{ Bindings: any }>();

app.use('*', cors());

app.get('/', (c) => c.text('Cerebro API Node Online'));

// Specialized route for voice upload (binary data)
app.post('/project/:id/voice', async (c) => {
    try {
        const id = c.req.param('id');
        const agentId = c.env.RESEARCH_AGENT.idFromName(id);
        const stub = c.env.RESEARCH_AGENT.get(agentId);

        const audioData = await c.req.arrayBuffer();
        // @ts-ignore
        const result = await stub.addNote(new Uint8Array(audioData));
        return c.json(result);
    } catch (e: any) {
        console.error("Voice Route Error:", e);
        return c.json({ error: e.message }, 500);
    }
});

app.post('/project/:id/explore', async (c) => {
    try {
        const id = c.req.param('id');
        const { nodeId, query } = await c.req.json();
        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.exploreTopic(nodeId, query);
        return c.json(result);
    } catch (e) {
        return c.json({ error: (e as Error).message }, 500);
    }
});

app.post('/project/:id/expandResearch', async (c) => {
    try {
        const id = c.req.param('id');
        const { nodeId } = await c.req.json();
        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.expandResearch(nodeId as string);
        return c.json(result);
    } catch (e: any) {
        console.error("Expand Proxy Error:", e);
        return c.json({ error: e.message }, 500);
    }
});

app.get('/project/:id/trace', async (c) => {
    try {
        const id = c.req.param('id');
        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.getTrace();
        return c.json(result);
    } catch (e: any) {
        console.error("Trace Proxy Error:", e);
        return c.json({ error: e.message }, 500);
    }
});

app.post('/project/:id/create', async (c) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json();
        console.log("initProject Proxy Body:", body);
        const { name, topic } = body;
        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.initProject(name, topic);
        return c.json(result);
    } catch (e: any) {
        console.error("Init Proxy Error:", e);
        return c.json({ error: e.message }, 500);
    }
});

app.post('/project/:id/startDiscovery', async (c) => {
    try {
        const id = c.req.param('id');
        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.startDiscovery();
        return c.json(result);
    } catch (e: any) {
        console.error("Discovery Proxy Error:", e);
        return c.json({ error: e.message }, 500);
    }
});

app.post('/project/:id/updatePositions', async (c) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json();
        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.updateNodePositions(body);
        return c.json(result);
    } catch (e: any) {
        console.error("Positions Proxy Error:", e);
        return c.json({ error: e.message }, 500);
    }
});

app.post('/project/:id/deleteEntity', async (c) => {
    try {
        const id = c.req.param('id');
        const body = await c.req.json();
        const nodeIds = Array.isArray(body.nodeIds) ? body.nodeIds : [body.nodeId];
        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.deleteEntity(nodeIds);
        return c.json(result);
    } catch (e: any) {
        console.error("Delete Proxy Error:", e);
        return c.json({ error: e.message }, 500);
    }
});

app.get('/project/:id/getProjectData', async (c) => {
    try {
        const id = c.req.param('id');
        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.getProjectData();
        return c.json(result);
    } catch (e: any) {
        console.error("Data Proxy Error:", e);
        return c.json({ error: e.message }, 500);
    }
});

app.post('/project/:id/getInitialSuggestion', async (c) => {
    try {
        const id = c.req.param('id');
        const { nodeId } = await c.req.json();
        const agent = c.env.RESEARCH_AGENT.get(c.env.RESEARCH_AGENT.idFromName(id));
        // @ts-ignore
        const result = await agent.getInitialSuggestion(nodeId);
        return c.json(result);
    } catch (e: any) {
        console.error("Get Initial Suggestion Error:", e);
        return c.json({ error: e.message }, 500);
    }
});

export { CerebroAgent, DeepDiveWorkflow };
export default app;
