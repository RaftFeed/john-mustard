import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

// Exercise the actual converter shipped in the pinned gateway route artifact.
const route = fs.readFileSync(new URL("../config/9router-route-0.5.104.cjs", import.meta.url), "utf8");
const start = route.indexOf("async function u(a,b){let c;if(!a.ok)");
const end = route.indexOf("d()}catch", start);
assert.ok(start >= 0 && end > start, "Reinspect the converter when upgrading 9Router");
const convert = vm.runInNewContext(`(${route.slice(start, end)})`, {
  Response,
  x: { tool_calls: "STOP", stop: "STOP" }
});
const requestStart = route.indexOf("l=function(a,b,c){") + 2;
const requestEnd = route.indexOf("}(j,f,k),m=new Request", requestStart) + 1;
assert.ok(requestStart > 1 && requestEnd > requestStart);
const convertRequest = vm.runInNewContext(`(${route.slice(requestStart, requestEnd)})`);

test("Gateway native request preserves tool declarations, required mode and tool history", () => {
  const request = convertRequest({
    contents: [
      { role: "user", parts: [{ text: "List tasks" }] },
      { role: "model", parts: [{ functionCall: { name: "listTodos", args: {} } }] },
      { role: "user", parts: [{ functionResponse: { name: "listTodos", response: { result: [] } } }] }
    ],
    tools: [{ functionDeclarations: [{ name: "listTodos", parameters: { type: "OBJECT", properties: {} } }] }],
    toolConfig: { functionCallingConfig: { mode: "ANY" } }
  }, "ag/test", false);
  assert.equal(request.tools[0].function.name, "listTodos");
  assert.equal(request.tools[0].function.parameters.type, "object");
  assert.equal(request.tool_choice, "required");
  assert.equal(request.messages[1].tool_calls[0].function.name, "listTodos");
  assert.equal(request.messages[2].role, "tool");
  assert.equal(request.messages[2].tool_call_id, request.messages[1].tool_calls[0].id);
  assert.equal(request.stream, false);
});

test("Gateway native route preserves tool calls alongside text, reasoning and usage", async () => {
  const result = await convert(Response.json({
    choices: [{ message: {
      reasoning_content: "Internal reasoning",
      content: "Checking tasks",
      tool_calls: [{ function: { name: "listTodos", arguments: '{"tag":"work"}' } }]
    }, finish_reason: "tool_calls" }],
    usage: { prompt_tokens: 4, completion_tokens: 8, total_tokens: 12 }
  }), "ag/test");
  const data = await result.json();
  assert.deepEqual(data.candidates[0].content.parts, [
    { text: "Internal reasoning", thought: true },
    { functionCall: { name: "listTodos", args: { tag: "work" } } },
    { text: "Checking tasks" }
  ]);
  assert.equal(data.candidates[0].finishReason, "STOP");
  assert.equal(data.usageMetadata.totalTokenCount, 12);
  assert.equal(data.usageMetadata.candidatesTokenCount, 8);
});

test("Gateway native route preserves multiple function calls without text", async () => {
  const response = await convert(Response.json({ choices: [{ message: {
    tool_calls: [
      { function: { name: "listTodos", arguments: "{}" } },
      { function: { name: "listReminders", arguments: { limit: 2 } } }
    ]
  }, finish_reason: "tool_calls" }] }), "ag/test");
  const parts = (await response.json()).candidates[0].content.parts;
  assert.deepEqual(parts, [
    { functionCall: { name: "listTodos", args: {} } },
    { functionCall: { name: "listReminders", args: { limit: 2 } } }
  ]);
});
