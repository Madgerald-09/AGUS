// One-shot isolated genuine-model browser acceptance only. No production import.
const ordinaryFetch = globalThis.fetch;
let calls = 0;
let last = 0;
let queue = Promise.resolve();
const max = 18;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input?.url ?? "";
  if (!/^https:\/\/generativelanguage\.googleapis\.com\/v1beta\/models\//.test(url))
    return ordinaryFetch(input, init);
  const gate = queue.then(async () => {
    if (calls >= max) return false;
    const wait = Math.max(0, 5000 - (Date.now() - last));
    if (wait) await new Promise((r) => setTimeout(r, wait));
    if (calls >= max) return false;
    last = Date.now();
    calls += 1;
    console.log("AGUS_GEMINI_REQUEST_START " + calls + "/" + max);
    return true;
  });
  queue = gate.then(() => {}, () => {});
  if (!(await gate)) {
    console.error("AGUS_GEMINI_HARD_CALL_LIMIT");
    throw new Error("GEMINI_CALL_BUDGET_EXCEEDED");
  }
  return ordinaryFetch(input, init);
};