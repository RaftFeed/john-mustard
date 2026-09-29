import test from "node:test";
import assert from "node:assert";
import { geminiPayloadToOpenAI, openAIToGeminiResponse } from "../src/llm/adapter.js";
import { extractCandidateText } from "../src/llm/engine.js";

test("Adapter: geminiPayloadToOpenAI translates system, user, tools, and tool responses", () => {
  const geminiPayload = {
    systemInstruction: { parts: [{ text: "You are John Mustard." }] },
    contents: [
      { role: "user", parts: [{ text: "hapus to-do 1" }] },
      {
        role: "model",
        parts: [
          {
            functionCall: {
              name: "deleteTodo",
              args: { todoId: 1, confirmed: true }
            }
          }
        ]
      },
      {
        role: "user",
        parts: [
          {
            functionResponse: {
              name: "deleteTodo",
              response: { result: { success: true } }
            }
          }
        ]
      }
    ],
    tools: [
      {
        functionDeclarations: [
          {
            name: "deleteTodo",
            description: "Hapus todo",
            parameters: { type: "OBJECT", properties: { todoId: { type: "NUMBER" } } }
          }
        ]
      }
    ]
  };

  const openAIPayload = geminiPayloadToOpenAI("ag/gemini-3.8-flash", geminiPayload);
  assert.strictEqual(openAIPayload.model, "ag/gemini-3.8-flash");
  assert.strictEqual(openAIPayload.messages.length, 4);
  assert.strictEqual(openAIPayload.messages[0].role, "system");
  assert.strictEqual(openAIPayload.messages[0].content, "You are John Mustard.");
  assert.strictEqual(openAIPayload.messages[1].role, "user");
  assert.strictEqual(openAIPayload.messages[1].content, "hapus to-do 1");
  assert.strictEqual(openAIPayload.messages[2].role, "assistant");
  assert.strictEqual(openAIPayload.messages[2].tool_calls.length, 1);
  assert.strictEqual(openAIPayload.messages[2].tool_calls[0].function.name, "deleteTodo");
  assert.strictEqual(openAIPayload.messages[3].role, "tool");
  assert.strictEqual(openAIPayload.messages[3].name, "deleteTodo");
  assert.strictEqual(openAIPayload.messages[3].content, JSON.stringify({ success: true }));
  assert.strictEqual(openAIPayload.tools.length, 1);
  assert.strictEqual(openAIPayload.tools[0].function.name, "deleteTodo");
});

test("Adapter: openAIToGeminiResponse translates tool_calls and reasoning_content", () => {
  const openAIRes = {
    model: "ag/gemini-3.8-flash",
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          reasoning_content: "Analyzing deleteTodo action...",
          tool_calls: [
            {
              id: "call_123",
              type: "function",
              function: {
                name: "deleteTodo",
                arguments: JSON.stringify({ todoId: 5 })
              }
            }
          ]
        },
        finish_reason: "tool_calls"
      }
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      completion_tokens_details: { reasoning_tokens: 15 }
    }
  };

  const geminiRes = openAIToGeminiResponse(openAIRes, "ag/gemini-3.8-flash");
  assert.strictEqual(geminiRes.candidates.length, 1);
  const parts = geminiRes.candidates[0].content.parts;
  assert.strictEqual(parts.length, 2);
  assert.strictEqual(parts[0].thought, true);
  assert.strictEqual(parts[0].text, "Analyzing deleteTodo action...");
  assert.deepStrictEqual(parts[1].functionCall, {
    name: "deleteTodo",
    args: { todoId: 5 }
  });
  assert.strictEqual(geminiRes.candidates[0].finishReason, "STOP");
});

test("LLM Engine: extractCandidateText filters out leaked CoT headers without thought flag", () => {
  const candidateLeak = {
    parts: [
      {
        text: "Analyzing the 'deleteTodo' Action\n\nOkay, the user wants to delete overdue tasks - 'yg kelewat apus aja'. I see two items on the list marked [TERLEWAT]. I should call deleteTodo."
      }
    ]
  };
  // Should return empty string since entire text is internal thinking
  assert.strictEqual(extractCandidateText(candidateLeak), "");

  const candidateLeakWithReply = {
    parts: [
      {
        text: "Analyzing the 'deleteTodo' Action\n\nI need to confirm first.\n\nAda 2 to-do yang terlewat, yakin mau dihapus?"
      }
    ]
  };
  assert.strictEqual(extractCandidateText(candidateLeakWithReply), "Ada 2 to-do yang terlewat, yakin mau dihapus?");

  const candidateBoldAsterisks = {
    parts: [
      {
        text: "*Analyzing the `deleteTodo` Function and its Behavior*\n\nOkay, let's break this down.\n\n🌄 [To-Do List]\n_Selamat malam!_\n\n🟢 *[1] Task 1*"
      }
    ]
  };
  assert.strictEqual(extractCandidateText(candidateBoldAsterisks), "🌄 [To-Do List]\n_Selamat malam!_\n\n🟢 *[1] Task 1*");

  const candidateFullLeakBold = {
    parts: [
      {
        text: "**Analyzing the User's Request**\n\nOkay, let's see what needs to be deleted."
      }
    ]
  };
  assert.strictEqual(extractCandidateText(candidateFullLeakBold), "");
});

