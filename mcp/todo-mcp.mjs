#!/usr/bin/env node
'use strict';

/**
 * mcp/todo-mcp.mjs — local stdio MCP server for the Uiineed Todo List.
 *
 * Talks to api.php (docs/superpowers/specs/2026-09-08-api-and-mcp-design.md)
 * over HTTPS using a bearer token. Runs entirely on this machine — nothing
 * new is publicly reachable. Zero dependencies: hand-rolled
 * newline-delimited JSON-RPC 2.0 over stdio, implementing only what a client
 * actually needs (initialize, ping, tools/list, tools/call). No
 * package.json, no @modelcontextprotocol/sdk — matches this project's
 * build-free convention (Vue vendored as a file, tests run as plain node).
 * Tradeoff, stated plainly: the SDK tracks MCP protocol revisions
 * automatically; this hand-rolled version does not.
 *
 * Credentials: TODO_API_URL + TODO_API_TOKEN from the environment, or (if
 * either is unset) sourced from ~/.config/creds/todo.env:
 *
 *   TODO_API_URL='https://<host>/api.php'
 *   TODO_API_TOKEN='<64 hex chars>'
 *
 * The token is never logged and never echoed in a request body.
 *
 * Register in ~/.claude.json pointing at this file's absolute path, with no
 * token inline — the server reads its own credentials.
 */

import { createInterface } from 'node:readline';
import { homedir } from 'node:os';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SERVER_NAME = 'uiineed-todo-mcp';
const SERVER_VERSION = '1.0.1';
const PROTOCOL_VERSION = '2024-11-05';
const API_TIMEOUT_MS = 15000; // a hung request otherwise hangs the tool call forever

// ---- Credentials ------------------------------------------------------------

function loadCredsFile() {
    const path = join(homedir(), '.config', 'creds', 'todo.env');
    if (!existsSync(path)) return {};
    const out = {};
    for (const line of readFileSync(path, 'utf8').split('\n')) {
        const m = /^([A-Z_][A-Z0-9_]*)=(.*)$/.exec(line.trim());
        if (!m) continue;
        let value = m[2];
        // Values in this file are single-quoted by convention.
        if (value.length >= 2 && value[0] === "'" && value[value.length - 1] === "'") {
            value = value.slice(1, -1);
        }
        out[m[1]] = value;
    }
    return out;
}

let TODO_API_URL = process.env.TODO_API_URL;
let TODO_API_TOKEN = process.env.TODO_API_TOKEN;
if (!TODO_API_URL || !TODO_API_TOKEN) {
    const creds = loadCredsFile();
    TODO_API_URL = TODO_API_URL || creds.TODO_API_URL;
    TODO_API_TOKEN = TODO_API_TOKEN || creds.TODO_API_TOKEN;
}
if (!TODO_API_URL || !TODO_API_TOKEN) {
    process.stderr.write(
        'todo-mcp: missing TODO_API_URL / TODO_API_TOKEN ' +
        '(checked the environment and ~/.config/creds/todo.env)\n'
    );
    process.exit(1);
}

// ---- api.php client -----------------------------------------------------

async function apiCall(method, extraParams, body) {
    const url = new URL(TODO_API_URL);
    url.searchParams.set('resource', 'tasks');
    for (const [k, v] of Object.entries(extraParams || {})) url.searchParams.set(k, v);

    const res = await fetch(url, {
        method,
        headers: {
            'Authorization': `Bearer ${TODO_API_TOKEN}`,
            'Content-Type': 'application/json',
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });

    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* fall through to the error below */ }

    if (!res.ok || !json || json.ok !== true) {
        const detail = (json && json.error) ? json.error : `HTTP ${res.status}`;
        throw new Error(`todo API ${method} failed: ${detail}`);
    }
    return json;
}

// ---- Tools ------------------------------------------------------------------

const TOOLS = [
    {
        name: 'list_tasks',
        description: 'List tasks on the todo list, optionally filtered by status.',
        inputSchema: {
            type: 'object',
            properties: {
                filter: {
                    type: 'string',
                    enum: ['all', 'active', 'completed'],
                    description: 'Defaults to all.',
                },
            },
        },
    },
    {
        name: 'add_task',
        description: 'Add a new task to the todo list.',
        inputSchema: {
            type: 'object',
            properties: { title: { type: 'string', description: 'The task title.' } },
            required: ['title'],
        },
    },
    {
        name: 'complete_task',
        description: 'Mark a task as completed.',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'The task id, from list_tasks.' } },
            required: ['id'],
        },
    },
    {
        name: 'delete_task',
        description: 'Delete a task (moves it to the recycle bin).',
        inputSchema: {
            type: 'object',
            properties: { id: { type: 'string', description: 'The task id, from list_tasks.' } },
            required: ['id'],
        },
    },
];

async function callTool(name, args) {
    args = args || {};
    if (name === 'list_tasks') {
        const { tasks } = await apiCall('GET', {});
        const filter = args.filter || 'all';
        if (filter === 'active') return tasks.filter((t) => !t.completed);
        if (filter === 'completed') return tasks.filter((t) => t.completed);
        return tasks;
    }
    if (name === 'add_task') {
        if (!args.title || typeof args.title !== 'string') throw new Error('title is required');
        const { task } = await apiCall('POST', {}, { title: args.title });
        return task;
    }
    if (name === 'complete_task') {
        if (!args.id) throw new Error('id is required');
        const { task } = await apiCall('PATCH', { id: args.id }, { completed: true });
        return task;
    }
    if (name === 'delete_task') {
        if (!args.id) throw new Error('id is required');
        const { task } = await apiCall('DELETE', { id: args.id });
        return task;
    }
    throw new Error(`unknown tool: ${name}`);
}

// ---- JSON-RPC 2.0 over stdio --------------------------------------------

function send(message) {
    process.stdout.write(JSON.stringify(message) + '\n');
}

function sendResult(id, result) {
    if (id === undefined) return; // a notification carries no id and expects no response
    send({ jsonrpc: '2.0', id, result });
}

function sendError(id, code, message) {
    if (id === undefined) return;
    send({ jsonrpc: '2.0', id, error: { code, message } });
}

async function handle(msg) {
    const { id, method, params } = msg;
    try {
        if (method === 'initialize') {
            sendResult(id, {
                protocolVersion: PROTOCOL_VERSION,
                capabilities: { tools: {} },
                serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
            });
            return;
        }
        if (method === 'notifications/initialized') {
            return;
        }
        if (method === 'ping') { // MCP liveness check; must answer with an empty result
            sendResult(id, {});
            return;
        }
        if (method === 'tools/list') {
            sendResult(id, { tools: TOOLS });
            return;
        }
        if (method === 'tools/call') {
            const name = params && params.name;
            const args = params && params.arguments;
            try {
                const result = await callTool(name, args);
                sendResult(id, { content: [{ type: 'text', text: JSON.stringify(result) }] });
            } catch (e) {
                sendResult(id, { content: [{ type: 'text', text: e.message }], isError: true });
            }
            return;
        }
        sendError(id, -32601, `method not found: ${method}`);
    } catch (e) {
        sendError(id, -32603, e.message || 'internal error');
    }
}

process.on('unhandledRejection', (e) => {
    process.stderr.write('todo-mcp: unhandled rejection: ' + (e && e.stack ? e.stack : e) + '\n');
});

const rl = createInterface({ input: process.stdin, terminal: false });
rl.on('line', (line) => {
    line = line.trim();
    if (!line) return;
    let msg;
    try {
        msg = JSON.parse(line);
    } catch (e) {
        sendError(null, -32700, 'parse error');
        return;
    }
    handle(msg);
});
