/** Compatibility entry point; the implementation ships inside the Skill bundle. */
export * from '../skills/uat-scenario-design/scripts/render_output.ts';
import { main } from '../skills/uat-scenario-design/scripts/render_output.ts';
import { direct } from '../skills/uat-scenario-design/scripts/json_compat.ts';
if (direct(import.meta.url)) process.exitCode = main();
