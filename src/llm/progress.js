// Progress is independent of the provider: a slow LLM must not delay its own status.
export function formatProgress({ speakerName = "", customTone = "", isGroup = false, tool = "", followUp = false } = {}) {
  const formal = /formal|santun|sopan/i.test(customTone);
  // Free-form preferences cannot safely be interpreted by a template. Use neutral
  // wording without a nickname whenever a custom preference is present.
  const family = /^(mami|papi)$/i.test(speakerName);
  const name = customTone ? "" : family ? speakerName : (!isGroup && /^rafid$/i.test(speakerName) ? "Lord" : "");
  const suffix = name ? `, ${name}` : "";
  if (tool === "listTodos" || tool === "getTodoDetail") {
    return formal ? `Sedang memeriksa daftar tugas${suffix}.` : `Lagi cek tugasnya${suffix}.`;
  }
  if (formal) return followUp ? "Prosesnya masih berjalan. Terima kasih sudah menunggu." : "Pesannya sedang diproses.";
  return followUp ? `Masih diproses${suffix}, agak lama kali ini.` : `Bentar${suffix}, lagi diproses.`;
}

export function startProgress(emit, getContext) {
  if (typeof emit !== "function") return async () => {};
  let stopped = false;
  let pending = Promise.resolve();
  const timers = [8000, 30000].map((delay, index) => setTimeout(() => {
    pending = pending.then(async () => {
      if (stopped) return;
      try {
        await emit(formatProgress({ ...getContext(), followUp: index > 0 }));
      } catch {
        // A failed status notification must not fail the user's actual request.
      }
    });
  }, delay));
  return async () => {
    stopped = true;
    timers.forEach(clearTimeout);
    // Finish any in-flight send before the caller sends the final reply.
    await pending;
  };
}
