// node --test: no AWS call. A fake Bedrock runtime client (anything with `send`) records the real ConverseCommand.
import assert from "node:assert/strict";
import { ConverseCommand } from "@aws-sdk/client-bedrock-runtime";
import { test } from "node:test";
import { bedrockLlm } from "./index.js";

const MODEL = "anthropic.claude-sonnet-4-20250514-v1:0";

function fakeBedrock(reply) {
  const sent = [];
  return {
    sent,
    async send(cmd) {
      sent.push(cmd);
      return reply ?? {
        output: { message: { role: "assistant", content: [{ text: "Stock for paneer is " }, { text: "4 kg." }] } },
        stopReason: "end_turn",
        usage: { inputTokens: 42, outputTokens: 7, totalTokens: 49 },
        $metadata: { httpStatusCode: 200 },
      };
    },
  };
}

test("complete sends a Converse request and parses text and usage", async () => {
  const client = fakeBedrock();
  const llm = bedrockLlm({ region: "ap-south-1", modelId: MODEL, client, env: {} });
  const out = await llm.complete({
    system: "You are Munim, a restaurant back-office assistant.",
    messages: [{ role: "user", content: "How much paneer is left?" }],
    maxTokens: 256,
    temperature: 0.2,
  });
  assert.equal(client.sent.length, 1);
  const cmd = client.sent[0];
  assert.ok(cmd instanceof ConverseCommand);
  assert.deepEqual(cmd.input, {
    modelId: MODEL,
    messages: [{ role: "user", content: [{ text: "How much paneer is left?" }] }],
    system: [{ text: "You are Munim, a restaurant back-office assistant." }],
    inferenceConfig: { maxTokens: 256, temperature: 0.2 },
  });
  assert.deepEqual(out, {
    text: "Stock for paneer is 4 kg.",
    usage: { inputTokens: 42, outputTokens: 7, totalTokens: 49 },
    stopReason: "end_turn",
    modelId: MODEL,
  });
});

test("system and inferenceConfig are omitted when not given; multi-turn roles pass through", async () => {
  const client = fakeBedrock();
  await bedrockLlm({ modelId: MODEL, client, env: {} }).complete({
    messages: [
      { role: "user", content: "hi" },
      { role: "assistant", content: "hello" },
      { role: "user", content: "orders today?" },
    ],
  });
  assert.deepEqual(client.sent[0].input, {
    modelId: MODEL,
    messages: [
      { role: "user", content: [{ text: "hi" }] },
      { role: "assistant", content: [{ text: "hello" }] },
      { role: "user", content: [{ text: "orders today?" }] },
    ],
  });
});

test("Munim roles map to model ids via `models`; unmapped roles use the default", async () => {
  const client = fakeBedrock();
  const llm = bedrockLlm({ modelId: MODEL, models: { extractor: "amazon.nova-lite-v1:0" }, client, env: {} });
  const a = await llm.complete({ role: "extractor", messages: [{ role: "user", content: "x" }] });
  const b = await llm.complete({ role: "planner", messages: [{ role: "user", content: "x" }] });
  assert.equal(client.sent[0].input.modelId, "amazon.nova-lite-v1:0");
  assert.equal(a.modelId, "amazon.nova-lite-v1:0");
  assert.equal(client.sent[1].input.modelId, MODEL);
  assert.equal(b.modelId, MODEL);
});

test("default model id comes from MUNIM_BEDROCK_MODEL_ID; missing model id throws", async () => {
  const client = fakeBedrock();
  await bedrockLlm({ client, env: { MUNIM_BEDROCK_MODEL_ID: "amazon.nova-pro-v1:0" } }).complete({ messages: [{ role: "user", content: "x" }] });
  assert.equal(client.sent[0].input.modelId, "amazon.nova-pro-v1:0");
  assert.throws(() => bedrockLlm({ client, env: {} }), /MUNIM_BEDROCK_MODEL_ID/);
});

test("errors carry the error name and status only, never prompt text", async () => {
  const secret = "SECRET-PROMPT-TEXT";
  const denied = bedrockLlm({
    modelId: MODEL,
    env: {},
    client: { send: async () => { throw Object.assign(new Error(`AccessDenied for ${secret}`), { name: "AccessDeniedException", $metadata: { httpStatusCode: 403 } }); } },
  });
  await assert.rejects(denied.complete({ system: secret, messages: [{ role: "user", content: secret }] }), (e) => {
    assert.equal(e.message, "llm bedrock: AccessDeniedException HTTP 403");
    assert.ok(!e.message.includes(secret));
    return true;
  });
  const down = bedrockLlm({ modelId: MODEL, env: {}, client: { send: async () => { throw new Error(`getaddrinfo ENOTFOUND ${secret}`); } } });
  await assert.rejects(down.complete({ messages: [{ role: "user", content: secret }] }), { message: "llm bedrock: Error (model unreachable)" });
  const empty = bedrockLlm({ modelId: MODEL, env: {}, client: fakeBedrock({ output: {} }) });
  await assert.rejects(empty.complete({ messages: [{ role: "user", content: "x" }] }), { message: "llm bedrock: no message in response" });
});

test("bad input is refused before any Bedrock call", async () => {
  const client = fakeBedrock();
  const llm = bedrockLlm({ modelId: MODEL, client, env: {} });
  await assert.rejects(llm.complete({ messages: [] }), /messages are required/);
  await assert.rejects(llm.complete({ messages: [{ role: "system", content: "x" }] }), /role must be user or assistant/);
  assert.equal(client.sent.length, 0);
});
