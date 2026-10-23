// llm-bedrock: the Amazon Bedrock LLM adapter, the AWS counterpart of Munim's Gemini / Vertex AI model calls. One
// `complete` call is one Bedrock Converse request (`ConverseCommand`, `@aws-sdk/client-bedrock-runtime`), so any
// Converse-capable model id or inference profile works without per-model request bodies. Munim roles (e.g. `planner`,
// `extractor`) can be pinned to different model ids through `models`; anything unmapped uses the default model.
// Errors carry the SDK error name and HTTP status only, never prompt or completion text.
import { BedrockRuntimeClient, ConverseCommand } from "@aws-sdk/client-bedrock-runtime";

/** @typedef {{ send: (command: any) => Promise<any> }} BedrockLike */
/** @typedef {{ role: "user" | "assistant", content: string }} LlmMessage */
/** @typedef {{ inputTokens: number, outputTokens: number, totalTokens: number }} LlmUsage */
/**
 * @typedef {{
 *   system?: string,
 *   messages: LlmMessage[],
 *   maxTokens?: number,
 *   temperature?: number,
 *   role?: string,
 * }} CompleteInput
 */
/** @typedef {{ text: string, usage: LlmUsage, stopReason?: string, modelId: string }} CompleteOutput */
/** @typedef {{ complete: (input: CompleteInput) => Promise<CompleteOutput> }} Llm */

/** @param {unknown} e */
const describe = (e) => {
  const err = /** @type {{ name?: string, $metadata?: { httpStatusCode?: number } }} */ (e ?? {});
  const s = err.$metadata?.httpStatusCode;
  const name = typeof err.name === "string" && /^[A-Za-z]+$/.test(err.name) ? err.name : "Error";
  return s ? `${name} HTTP ${s}` : `${name} (model unreachable)`;
};

/**
 * @param {{
 *   region?: string,
 *   modelId?: string,
 *   models?: Record<string, string>,
 *   client?: BedrockLike,
 *   env?: Record<string, string | undefined>,
 * }} [o]
 * @returns {Llm}
 */
export function bedrockLlm(o = {}) {
  const env = o.env ?? process.env;
  const modelId = o.modelId ?? env.MUNIM_BEDROCK_MODEL_ID;
  if (!modelId) throw new Error("bedrockLlm: modelId (or MUNIM_BEDROCK_MODEL_ID) is required");
  const region = o.region ?? env.AWS_REGION;
  const models = o.models ?? {};
  const client = o.client ?? new BedrockRuntimeClient(region ? { region } : {});
  return {
    async complete(input) {
      if (!Array.isArray(input?.messages) || input.messages.length === 0) throw new Error("llm complete: messages are required");
      const id = (input.role && models[input.role]) || modelId;
      /** @type {Record<string, number>} */
      const inferenceConfig = {};
      if (input.maxTokens !== undefined) inferenceConfig.maxTokens = input.maxTokens;
      if (input.temperature !== undefined) inferenceConfig.temperature = input.temperature;
      const command = new ConverseCommand({
        modelId: id,
        messages: input.messages.map((m) => {
          if (m.role !== "user" && m.role !== "assistant") throw new Error("llm complete: message role must be user or assistant");
          return { role: m.role, content: [{ text: String(m.content) }] };
        }),
        ...(input.system ? { system: [{ text: input.system }] } : {}),
        ...(Object.keys(inferenceConfig).length ? { inferenceConfig } : {}),
      });
      let out;
      try {
        out = await client.send(command);
      } catch (e) {
        throw new Error(`llm bedrock: ${describe(e)}`);
      }
      const content = out?.output?.message?.content;
      if (!Array.isArray(content)) throw new Error("llm bedrock: no message in response");
      const text = content.map((b) => (typeof b?.text === "string" ? b.text : "")).join("");
      const u = out.usage ?? {};
      const inputTokens = u.inputTokens ?? 0;
      const outputTokens = u.outputTokens ?? 0;
      return {
        text,
        usage: { inputTokens, outputTokens, totalTokens: u.totalTokens ?? inputTokens + outputTokens },
        stopReason: out.stopReason,
        modelId: id,
      };
    },
  };
}
