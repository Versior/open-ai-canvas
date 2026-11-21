import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runtime = fileURLToPath(new URL("./agent-runtime.mjs", import.meta.url));
const tools = [{ name: "read_fixture", parameters: { type: "object", properties: {} } }];
const toolCall = { id: "call-original", name: "read_fixture", arguments: {} };

async function runFixture(reply, request = {}, splitAt) {
  const directory = await mkdtemp(join(tmpdir(), "pi-bridge-test-"));
  const calls = [];
  let child;
  const server = createServer(async (incoming, outgoing) => {
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    calls.push({ path: incoming.url, payload });
    const body = await reply(incoming.url, payload, child, outgoing);
    if (outgoing.destroyed) return;
    outgoing.setHeader("content-type", "application/json");
    outgoing.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  child = spawn(process.execPath, [runtime], { stdio: ["pipe", "pipe", "pipe"], env: {
    PATH: process.env.PATH, PI_OFFLINE: "1", YINGCE_AGENT_RUN_DIR: directory, HOME: directory, TMPDIR: directory,
  } });
  const closed = once(child, "close");
  const timer = setTimeout(() => child.kill("SIGKILL"), 20000);
  let stdout = "", stderr = "";
  child.stdout.setEncoding("utf8").on("data", chunk => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", chunk => { stderr += chunk; });
  try {
    const bytes = Buffer.from(JSON.stringify({ bridgeURL: `http://127.0.0.1:${server.address().port}`, bridgeToken: "test", model: { id: "fixture", contextWindow: 500000, maxTokens: 1024 }, systemPrompt: "Offline test.", tools, prompt: "test", ...request }));
    if (splitAt) {
      const offset = splitAt(bytes);
      await new Promise((resolve, reject) => child.stdin.write(bytes.subarray(0, offset), error => error ? reject(error) : resolve()));
      child.stdin.end(bytes.subarray(offset));
    } else child.stdin.end(bytes);
    const [code, signal] = await closed;
    return { code, signal, calls, frames: stdout.trim().split("\n").filter(Boolean).map(JSON.parse), stderr };
  } finally {
    clearTimeout(timer);
    if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await closed; }
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(directory, { recursive: true, force: true });
  }
}

const finalText = "已完成。🎬";
const modelReply = { text: finalText, messageId: "step-1" };
const normal = path => path === "/model" ? modelReply : { ok: true };
const eventsOf = result => result.calls.filter(call => call.path === "/event").map(call => call.payload);
const messagesOf = snapshot => snapshot.trim().split("\n").map(JSON.parse).filter(entry => entry.type === "message").map(entry => entry.message);
const textOf = message => message.content.filter(part => part.type === "text").map(part => part.text).join("");

test("large Chinese prompts and resumed history keep every UTF-8 character across pipe reads", async () => {
  const prompt = "这个画面换成夜景。🎥".repeat(6000);
  const first = await runFixture(normal, { prompt }, bytes => bytes.indexOf(Buffer.from("🎥"), 81000) + 2);
  assert.equal(first.code, 0, first.stderr);
  assert.equal(textOf(first.calls.find(call => call.path === "/model").payload.messages.find(message => message.role === "user")) === prompt, true, "model input changed");
  const sessionJSONL = eventsOf(first).findLast(event => event.type === "session_snapshot").sessionJSONL;
  assert.equal(textOf(messagesOf(sessionJSONL).find(message => message.role === "user")) === prompt, true, "saved input changed");
  const resumed = await runFixture(normal, { sessionJSONL, prompt: "补一镜" }, bytes => bytes.indexOf(Buffer.from("换"), 81000) + 1);
  assert.equal(resumed.code, 0, resumed.stderr);
  const users = resumed.calls.find(call => call.path === "/model").payload.messages.filter(message => message.role === "user").map(textOf);
  assert.equal(users.length, 2);
  assert.equal(users[0] === prompt && users[1] === "补一镜", true, "restored input changed");
});

test("the SDK emits one actual text batch, in order, not fabricated token events", async () => {
  const result = await runFixture(normal);
  assert.equal(result.code, 0, result.stderr);
  const events = eventsOf(result).filter(event => event.type.startsWith("message_"));
  assert.deepEqual(events.map(event => event.type), ["message_start", "message_delta", "message_end"]);
  assert.deepEqual([events[1].delta, events[1].messageId], [finalText, "step-1"]);
  assert.equal(textOf(events[2].message), finalText);
});

test("malformed success responses fail closed without a settled frame", async t => {
  for (const [label, endpoint, body] of [
    ["truncated model", "/model", "{"], ["empty model", "/model", {}],
    ["whitespace-only model", "/model", { text: "  " }], ["incomplete tool call", "/model", { toolCalls: [{}] }],
    ["duplicate tool IDs", "/model", { toolCalls: [toolCall, toolCall] }],
    ["unconfirmed event", "/event", {}], ["empty snapshot ack", "session_snapshot", ""],
    ["missing tool receipt", "/tool", {}],
  ]) await t.test(label, async () => {
    let modelCalls = 0;
    const result = await runFixture((path, payload) => {
      if (path === endpoint || payload.type === endpoint) return body;
      if (path === "/model" && endpoint === "/tool" && ++modelCalls === 1) return { toolCalls: [toolCall] };
      return normal(path);
    });
    const events = eventsOf(result);
    assert.equal(result.code, 1, result.stderr);
    assert.ok(result.frames.some(frame => frame.event === "runtime_error"), result.stderr);
    assert.ok(!result.frames.some(frame => frame.event === "settled"));
    if (endpoint === "/model") assert.ok(!events.some(event => event.type === "message_end"));
    if (endpoint === "/tool") assert.equal(modelCalls, 1, "must not schedule another billable step with a fabricated error receipt");
  });
});

test("a killed process resumes its durably acknowledged tool receipt without a second execution", async t => {
  const storage = await mkdtemp(join(tmpdir(), "pi-checkpoint-test-"));
  t.after(() => rm(storage, { recursive: true, force: true }));
  const file = join(storage, "committed.jsonl");
  const receipt = "已读取素材 🎬\n原始行。";
  let models = 0, executions = 0, committed = 0, acknowledgedBeforeNext = false;
  const killed = await runFixture(async (path, payload, child) => {
    if (path === "/tool") { executions++; return { content: receipt }; }
    if (path === "/model") {
      if (++models === 1) return { toolCalls: [toolCall] };
      acknowledgedBeforeNext = committed === 1;
      child.kill("SIGKILL");
      return modelReply;
    }
    if (payload.type === "session_snapshot") {
      await new Promise(resolve => setTimeout(resolve, 40));
      await writeFile(file, payload.sessionJSONL);
      committed++;
    }
    return { ok: true };
  });
  assert.equal(killed.signal, "SIGKILL");
  assert.equal(acknowledgedBeforeNext, true, "model step started before the checkpoint commit returned");
  assert.ok(!killed.frames.some(frame => frame.event === "settled"));
  const sessionJSONL = await readFile(file, "utf8");
  const last = messagesOf(sessionJSONL).at(-1);
  assert.deepEqual([last.role, last.toolCallId, textOf(last)], ["toolResult", toolCall.id, receipt]);
  const resumed = await runFixture(path => {
    if (path === "/tool") { executions++; return { content: receipt }; }
    return normal(path);
  }, { sessionJSONL, prompt: "继续上一轮" });
  assert.equal(resumed.code, 0, resumed.stderr);
  const requests = resumed.calls.filter(call => call.path === "/model");
  assert.equal(requests.length, 1);
  const calls = requests[0].payload.messages.filter(message => message.role === "assistant").flatMap(message => message.content.filter(part => part.type === "toolCall"));
  const receipts = requests[0].payload.messages.filter(message => message.role === "toolResult");
  assert.deepEqual(calls.map(call => call.id), [toolCall.id]);
  assert.deepEqual(receipts.map(message => [message.toolCallId, textOf(message)]), [[toolCall.id, receipt]]);
  assert.equal(executions, 1);
  assert.ok(resumed.frames.some(frame => frame.event === "settled"));
});

test("an unconfirmed tool checkpoint blocks the next model step", async () => {
  let models = 0;
  const result = await runFixture((path, payload) => {
    if (path === "/model") return ++models === 1 ? { toolCalls: [toolCall] } : modelReply;
    if (path === "/tool") return { content: "receipt" };
    return payload.type === "session_snapshot" ? { ok: false } : { ok: true };
  });
  assert.equal(models, 1);
  assert.deepEqual(result.frames.map(frame => frame.event), ["runtime_error"]);
  assert.equal(result.code, 1, result.stderr);
});

test("a lost tool reply is not a receipt; a confirmed tool error can be explained", async t => {
  for (const lost of [true, false]) await t.test(lost ? "disconnect" : "business rejection", async () => {
    let models = 0;
    const result = await runFixture((path, payload, child, outgoing) => {
      if (path === "/model") return ++models === 1 ? { toolCalls: [toolCall] } : modelReply;
      if (path === "/tool") {
        if (lost) outgoing.destroy();
        else outgoing.statusCode = 422;
        return { error: "synthetic tool rejection" };
      }
      return { ok: true };
    });
    assert.equal(models, lost ? 1 : 2);
    assert.equal(result.code, lost ? 1 : 0, result.stderr);
    assert.deepEqual(result.frames.map(frame => frame.event), [lost ? "runtime_error" : "settled"]);
  });
});
