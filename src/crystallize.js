import { generateContent } from "./llm.js";

// Tool categories considered trivial/read-only that don't warrant standalone skills on their own
export const TRIVIAL_TOOLS = new Set([
  "listTodos",
  "listVaultFiles",
  "listSkills",
  "listBacklogs",
  "saveSkill",
  "deleteSkill",
  "getTodosDue"
]);

/**
 * Fast pre-filter to determine if a turn warrants autonomous skill crystallization.
 * Prevents skill pollution on trivial or casual turns.
 */
export function shouldAttemptCrystallization(executedTools = [], userMessage = "") {
  if (!executedTools || executedTools.length === 0) return false;

  const successfulTools = executedTools.filter((t) => !t.result?.error);
  if (successfulTools.length === 0) return false;

  const toolNames = successfulTools.map((t) => t.name);
  const nonTrivial = [...new Set(toolNames.filter((n) => !TRIVIAL_TOOLS.has(n)))];

  // Trigger Condition 1: Multi-step pipeline (2+ distinct non-trivial tools)
  // e.g. searchWeb + addTodo, or readUrl + executePython, or searchVault + executePython
  if (nonTrivial.length >= 2) return true;

  // Trigger Condition 2: Custom Python computation solved via executePython (> 40 chars)
  if (toolNames.includes("executePython")) {
    for (const t of successfulTools) {
      if (t.name === "executePython") {
        const code = String(t.args?.code || "").trim();
        if (code.length > 40) return true;
      }
    }
  }

  // Trigger Condition 3: Explicit teaching language in user message
  const teachPatterns = /(?:mulai sekarang|setiap kali|kalau ada|prosedurnya|caranya|aturan baru|formatnya|ingat cara|pelajari cara|jadikan skill|catat alur)\b/i;
  if (teachPatterns.test(userMessage)) return true;

  return false;
}

/**
 * Asynchronous background reflection engine (Voyager / Hermes Agent pattern).
 * Runs fire-and-forget after the response has been sent to the user.
 * Synthesizes new skills into SQLite store when novel workflows are discovered.
 */
export async function autoCrystallizeTurn({
  senderName = "user",
  userMessage = "",
  executedTools = [],
  finalReply = "",
  store,
  rotator
}) {
  try {
    if (!store || !rotator) return null;
    if (!shouldAttemptCrystallization(executedTools, userMessage)) return null;

    const existingSkills = store.getSkills ? store.getSkills() : [];
    const existingNames = existingSkills.map((s) => s.name);

    const trajectorySteps = executedTools.map((t, idx) => {
      const status = t.result?.error ? `error: ${t.result.error}` : "success";
      const snippet = JSON.stringify(t.result || {}).slice(0, 300);
      return `${idx + 1}. Tool \`${t.name}\` (${status})\n   Args: ${JSON.stringify(t.args || {})}\n   Output: ${snippet}`;
    }).join("\n");

    const criticPrompt = `You are the Procedural Memory & Autonomous Skill Crystallizer for John Mustard (WhatsApp AI Executive Assistant).

Evaluate this completed turn trajectory to determine if a novel, reusable operational procedure, multi-step tool workflow, or SOP was discovered that should be crystallized into a persistent skill.

### USER REQUEST:
"${userMessage}"

### TOOLS EXECUTED IN THIS TURN:
${trajectorySteps}

### FINAL RESPONSE:
"${finalReply}"

### EXISTING SKILLS IN SYSTEM:
${JSON.stringify(existingNames)}

### CRITERIA FOR CRYSTALLIZATION:
1. ONLY crystallize if the workflow is reusable for FUTURE similar tasks (e.g. specialized data format parsing, custom formula calculation, multi-step web research + task logging, automated reporting).
2. DO NOT crystallize one-off trivial queries (e.g. checking one task, reading one note, simple banter).
3. DO NOT duplicate an existing skill already in the system.
4. Output MUST be valid JSON strictly matching the schema below.

\`\`\`json
{
  "crystallize": true,
  "reason": "Brief explanation of why this is or isn't a reusable skill",
  "name": "auto_snake_case_name",
  "description": "One sentence description of when to use this skill",
  "promptTemplate": "Operational instructions describing the workflow and which tools to call"
}
\`\`\``;

    const payload = {
      contents: [{ role: "user", parts: [{ text: criticPrompt }] }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 1024,
        responseMimeType: "application/json"
      }
    };

    const responseData = await generateContent(rotator, payload);
    const rawText = responseData.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!rawText) return null;

    const cleanJson = rawText.replace(/```json\s*|\s*```/g, "").trim();
    const decision = JSON.parse(cleanJson);

    if (!decision.crystallize) {
      return null;
    }

    let rawName = (decision.name || "").trim().toLowerCase();
    rawName = rawName.replace(/^auto[_-]/, "");
    rawName = rawName.replace(/[^a-z0-9_-]/g, "_");
    if (!rawName) return null;

    const skillName = `auto_${rawName}`;
    const desc = (decision.description || "Autonomously crystallized operational skill.").trim();
    const template = (decision.promptTemplate || "").trim();

    if (skillName && template) {
      const saved = store.saveSkill(skillName, desc, template);
      console.log(`✨ [Auto-Crystallization] Synthesized new skill '${skillName}': ${desc}`);
      return saved;
    }
  } catch (err) {
    console.warn("[Crystallize] Background reflection error:", err.message);
  }
  return null;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("src/crystallize.js")) {
  import("node:assert").then(async ({ default: assert }) => {
    // 1. Empty or casual turn -> False
    assert.strictEqual(shouldAttemptCrystallization([], "halo bro"), false);
    assert.strictEqual(shouldAttemptCrystallization([{ name: "listTodos", result: { count: 0 } }], "cek tugas"), false);

    // 2. Failed tools only -> False
    assert.strictEqual(
      shouldAttemptCrystallization([{ name: "searchWeb", result: { error: "timeout" } }], "cari berita"),
      false
    );

    // 3. Multi-step non-trivial tools (searchWeb + addTodo) -> True
    assert.strictEqual(
      shouldAttemptCrystallization(
        [
          { name: "searchWeb", result: { results: [] } },
          { name: "addTodo", result: { success: true } }
        ],
        "cari info beasiswa lalu catat ke to-do list"
      ),
      true
    );

    // 4. executePython with trivial short snippet -> False
    assert.strictEqual(
      shouldAttemptCrystallization(
        [{ name: "executePython", args: { code: "print(2+2)" }, result: { stdout: "4\n" } }],
        "hitung 2 + 2"
      ),
      false
    );

    // 5. executePython with non-trivial complex snippet (> 40 chars) -> True
    assert.strictEqual(
      shouldAttemptCrystallization(
        [
          {
            name: "executePython",
            args: {
              code: "import pandas as pd\ndf = pd.DataFrame({'a': [1,2,3]})\nprint(df.describe())"
            },
            result: { stdout: "summary" }
          }
        ],
        "analisis data tabel ini"
      ),
      true
    );

    // 6. Explicit teaching phrasing in user message -> True
    assert.strictEqual(
      shouldAttemptCrystallization(
        [{ name: "addTodo", result: { success: true } }],
        "mulai sekarang setiap kali ada tugas kuliah tambahkan tag #kampus"
      ),
      true
    );

    assert.strictEqual(
      shouldAttemptCrystallization(
        [{ name: "addTodo", result: { success: true } }],
        "ingat cara format rekap bulanan ya"
      ),
      true
    );

    // 7. Mock autoCrystallizeTurn execution test
    const mockStore = {
      skills: {},
      getSkills() {
        return Object.values(this.skills);
      },
      saveSkill(name, description, promptTemplate) {
        this.skills[name] = { name, description, prompt_template: promptTemplate };
        return this.skills[name];
      }
    };

    const mockRotator = {
      async execute(fn) {
        return fn("fake-key");
      }
    };

    // Should skip immediately if shouldAttemptCrystallization is false
    const skipRes = await autoCrystallizeTurn({
      senderName: "user1",
      userMessage: "halo",
      executedTools: [],
      finalReply: "halo juga",
      store: mockStore,
      rotator: mockRotator
    });
    assert.strictEqual(skipRes, null);

    console.log("Crystallize module self-test OK");
  });
}
