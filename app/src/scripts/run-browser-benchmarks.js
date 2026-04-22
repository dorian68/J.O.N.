import { runBrowserBenchmarks } from "../benchmarks/browser-benchmarks.js";

const result = await runBrowserBenchmarks();
console.log(JSON.stringify(result, null, 2));
