import http from "node:http";

function geminiPayloadToOpenAI(model, payload) {
  const messages = [];

  if (payload.systemInstruction?.parts) {
    const sysText = payload.systemInstruction.parts
      .map((p) => p.text || "")
      .filter(Boolean)
      .join("\n");
    if (sysText) {
      messages.push({ role: "system", content: sysText });
    }
  }

  let callIdCounter = 1;
  const pendingCalls = [];

  if (Array.isArray(payload.contents)) {
    for (const c of payload.contents) {
      const parts = c.parts || [];
      if (c.role === "user") {
        const fnResponses = parts.filter((p) => p.functionResponse);
        if (fnResponses.length > 0) {
          for (const fr of fnResponses) {
            const toolCallId = fr.functionResponse.id || pendingCalls.shift() || `call_${callIdCounter++}`;
            messages.push({
              role: "tool",
              tool_call_id: toolCallId,
              name: fr.functionResponse.name,
              content: JSON.stringify(fr.functionResponse.response?.result ?? fr.functionResponse.response ?? {})
            });
          }
        }

        const nonFnParts = parts.filter((p) => !p.functionResponse);
        if (nonFnParts.length > 0) {
          if (nonFnParts.some((p) => p.inlineData)) {
            const contentArray = [];
            for (const p of nonFnParts) {
              if (p.text) contentArray.push({ type: "text", text: p.text });
              if (p.inlineData) {
                contentArray.push({
                  type: "image_url",
                  image_url: {
                    url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`
                  }
                });
              }
            }
            messages.push({ role: "user", content: contentArray });
          } else {
            const userText = nonFnParts.map((p) => p.text || "").join("\n").trim();
            if (userText) {
              messages.push({ role: "user", content: userText });
            }
          }
        }
      } else if (c.role === "model") {
        const fnCalls = parts.filter((p) => p.functionCall);
        const textParts = parts.filter((p) => p.text);
        const textContent = textParts.map((p) => p.text).join("\n").trim() || null;

        if (fnCalls.length > 0) {
          const toolCalls = fnCalls.map((fc, idx) => {
            const id = `call_${Date.now()}_${idx}_${callIdCounter++}`;
            pendingCalls.push(id);
            return {
              id,
              type: "function",
              function: {
                name: fc.functionCall.name,
                arguments: typeof fc.functionCall.args === "string"
                  ? fc.functionCall.args
                  : JSON.stringify(fc.functionCall.args || {})
              }
            };
          });
          messages.push({
            role: "assistant",
            content: textContent,
            tool_calls: toolCalls
          });
        } else if (textContent) {
          messages.push({ role: "assistant", content: textContent });
        }
      }
    }
  }

  let tools;
  if (Array.isArray(payload.tools)) {
    const fnDecls = payload.tools.flatMap((t) => t.functionDeclarations || []);
    if (fnDecls.length > 0) {
      tools = fnDecls.map((fn) => ({
        type: "function",
        function: {
          name: fn.name,
          description: fn.description || "",
          parameters: fn.parameters || { type: "object", properties: {} }
        }
      }));
    }
  }

  let tool_choice;
  const mode = payload.toolConfig?.functionCallingConfig?.mode;
  if (mode === "NONE") tool_choice = "none";
  else if (mode === "ANY" || mode === "REQUIRED") tool_choice = "required";
  else if (mode === "AUTO") tool_choice = "auto";

  return {
    model,
    messages,
    stream: false,
    ...(tools && tools.length > 0 ? { tools } : {}),
    ...(tool_choice ? { tool_choice } : {})
  };
}

function openAIToGeminiResponse(resData, model) {
  const choice = resData.choices?.[0];
  if (!choice) {
    return {
      candidates: [{
        content: { role: "model", parts: [{ text: "" }] },
        finishReason: "STOP",
        index: 0
      }],
      modelVersion: model
    };
  }

  const msg = choice.message || {};
  const parts = [];

  if (msg.reasoning_content) {
    parts.push({ text: msg.reasoning_content, thought: true });
  }

  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    for (const tc of msg.tool_calls) {
      let parsedArgs = {};
      try {
        parsedArgs = typeof tc.function?.arguments === "string"
          ? JSON.parse(tc.function.arguments)
          : (tc.function?.arguments || {});
      } catch {
        parsedArgs = {};
      }
      parts.push({
        functionCall: {
          name: tc.function?.name,
          args: parsedArgs
        }
      });
    }
  }

  if (msg.content) {
    parts.push({ text: msg.content });
  }

  const finishReason = choice.finish_reason === "tool_calls" ? "STOP" : (choice.finish_reason?.toUpperCase() || "STOP");

  return {
    candidates: [{
      content: {
        role: "model",
        parts: parts.length > 0 ? parts : [{ text: "" }]
      },
      finishReason,
      index: 0
    }],
    modelVersion: resData.model || model,
    usageMetadata: {
      promptTokenCount: resData.usage?.prompt_tokens || 0,
      candidatesTokenCount: resData.usage?.completion_tokens || 0,
      totalTokenCount: resData.usage?.total_tokens || 0,
      thoughtsTokenCount: resData.usage?.completion_tokens_details?.reasoning_tokens || 0
    }
  };
}

export { geminiPayloadToOpenAI, openAIToGeminiResponse };
