import { runComputerBenchmarks } from "../benchmarks/computer-benchmarks.js";

const result = await runComputerBenchmarks();
console.log(JSON.stringify(result, null, 2));
