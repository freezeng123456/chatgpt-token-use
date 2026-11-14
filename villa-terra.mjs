import http from 'node:http';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const model = process.env.OPENAI_MODEL || 'gpt-6.1-terra';
const keyFile = new URL('./.secrets/openai_api_key', import.meta.url);
const key = process.env.OPENAI_API_KEY || (existsSync(keyFile) ? readFileSync(keyFile, 'utf8').trim() : '');
if (!key) throw new Error('Set OPENAI_API_KEY or create .secrets/openai_api_key locally.');
const ledgerPath = new URL('./villa-usage.json', import.meta.url);
const ledger = existsSync(ledgerPath) ? JSON.parse(readFileSync(ledgerPath, 'utf8')) : [];
if (ledger.some(item => item.model && item.model !== model)) throw new Error('The villa ledger contains a different model.');
const maxRequests = Number(process.env.MAX_REQUESTS || 1000); // Includes connectivity checks.
if (!Number.isSafeInteger(maxRequests) || maxRequests < 1) throw new Error('MAX_REQUESTS must be a positive integer.');
const maxDollars = 10; // Conservative estimate for this villa run only.
const maxOutput = 512;
const conservativeInputRate = 1.25 / 1_000_000; // Includes the higher 30-minute cache-write rate.
const outputRate = 5 / 1_000_000;
let haltReason = null;
function save() { writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n', {mode:0o600}); }
function charged() { return ledger.reduce((sum, item) => sum + (item.dollars ?? item.reserved ?? 0), 0); }
function respond(res, content) {
    res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({
        id:`villa-${Date.now()}`, object:'chat.completion', created:Math.floor(Date.now()/1000), model,
        choices:[{index:0, message:{role:'assistant',content}, finish_reason:'stop'}]
    }));
}
http.createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
        res.writeHead(200, {'Content-Type':'application/json'}).end(JSON.stringify({
            model, requests:ledger.length, maxRequests, estimatedDollars:charged(), maxDollars, haltReason,
            completed:ledger.filter(x=>x.status==='completed').length,
            pending:ledger.filter(x=>x.status==='pending').length
        }));
        return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') return res.writeHead(404).end();
    try {
        let body = '';
        for await (const chunk of req) {
            body += chunk;
            if (Buffer.byteLength(body) > 128_000) throw new Error('Request exceeds the villa size limit.');
        }
        const input = JSON.parse(body);
        if (input.model !== model || input.stream || !Array.isArray(input.messages)) throw new Error('Unexpected request.');
        // UTF-8 bytes plus framing provide a conservative admission estimate for text input.
        const reserved = (Buffer.byteLength(JSON.stringify(input.messages)) + 2048) * conservativeInputRate + maxOutput * outputRate;
        if (ledger.length >= maxRequests || charged() + reserved > maxDollars) {
            haltReason = ledger.length >= maxRequests ? 'request_limit' : 'cost_limit';
            respond(res, '');
            return;
        }
        const entry = {call:ledger.length+1, model, status:'pending', reserved, started:new Date().toISOString()};
        ledger.push(entry);
        save();
        try {
            const response = await fetch('https://api.openai.com/v1/responses', {
                method:'POST', headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
                body:JSON.stringify({model, input:input.messages, reasoning:{effort:'low'}, max_output_tokens:maxOutput, store:false}),
                signal:AbortSignal.timeout(90_000)
            });
            const result = await response.json();
            if (!response.ok) throw new Error(`OpenAI returned HTTP ${response.status}: ${result.error?.message || 'unknown error'}`);
            const content = (result.output||[]).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('').trim();
            entry.status=result.status;
            // Keep historical failures in the ledger, but report a recovered
            // connection after a subsequent request completes successfully.
            if (result.status === 'completed' && haltReason === 'request_error') haltReason = null;
            entry.inputTokens=result.usage?.input_tokens;
            entry.outputTokens=result.usage?.output_tokens;
            entry.cachedTokens=result.usage?.input_tokens_details?.cached_tokens || 0;
            entry.cacheWriteTokens=result.usage?.input_tokens_details?.cache_write_tokens || 0;
            entry.reasoningTokens=result.usage?.output_tokens_details?.reasoning_tokens || 0;
            if (Number.isFinite(entry.inputTokens) && Number.isFinite(entry.outputTokens)) {
                entry.dollars=entry.inputTokens*conservativeInputRate+entry.outputTokens*outputRate;
                delete entry.reserved;
            }
            entry.finished=new Date().toISOString();
            if (result.status !== 'completed') entry.incompleteReason=result.incomplete_details?.reason || 'unknown';
            save();
            console.log(JSON.stringify({call:entry.call,status:entry.status,inputTokens:entry.inputTokens,outputTokens:entry.outputTokens,reasoningTokens:entry.reasoningTokens,dollars:entry.dollars,content}));
            // A truncated command must never be executed as though it were complete.
            respond(res, result.status === 'completed' ? content : '');
        } catch (error) {
            entry.status='unknown_or_failed';
            entry.error=error.message;
            haltReason='request_error';
            save();
            console.error(`Villa call ${entry.call}: ${error.message}`);
            respond(res, '');
        }
    } catch (error) {
        res.writeHead(400, {'Content-Type':'application/json'}).end(JSON.stringify({error:{message:error.message}}));
    }
}).listen(18084, '127.0.0.1', () => console.log('Villa gateway ready; gpt-6.1-terra, up to 1000 calls, estimated $10 ceiling.'));
