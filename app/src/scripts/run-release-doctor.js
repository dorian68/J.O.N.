import { buildReleaseDoctorReport } from "../release/release-doctor.js";

const report = await buildReleaseDoctorReport();

console.log(JSON.stringify(report, null, 2));

if (report.status === "fail") {
  process.exitCode = 1;
}

