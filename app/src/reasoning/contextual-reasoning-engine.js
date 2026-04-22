import { createDefaultContextAssembler } from "./context-assembler.js";

export class ContextualReasoningEngine {
  constructor({
    assembler = createDefaultContextAssembler()
  } = {}) {
    this.assembler = assembler;
  }

  createSnapshot(input) {
    return this.assembler.assemble(input);
  }
}

export function createDefaultContextualReasoningEngine() {
  return new ContextualReasoningEngine();
}
