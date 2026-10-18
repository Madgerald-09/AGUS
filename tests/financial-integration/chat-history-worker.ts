import { writeFileSync } from "node:fs";
import { chatHistory } from "../../src/lib/chat-history/store";
const store = chatHistory("restart-owner");
if (process.argv[2] === "write") {
  const lease = await store.claim("restart-chat", "Persist this conversation");
  await store.finish("restart-chat", lease, "Persist this conversation", {
    kind: "general",
    text: "Hello there.",
    citations: [],
    evidence: { modelCalls: 3, toolCalls: 0, resultBytes: 0 },
  });
}
writeFileSync(1, JSON.stringify((await store.read("restart-chat"))[0]));
process.exit(0);
