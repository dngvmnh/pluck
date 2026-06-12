/** Pipeline registry: OutputMode -> pipeline runner.
 *
 * Each pipeline is `run(ctx) -> Promise<filepath>` and returns the final deliverable.
 * The JobQueue (jobs.js) handles status transitions, caching and error capture.
 */
import { OutputMode } from "../models.js";
import * as chapters from "./chapters.js";
import * as convert from "./convert.js";
import * as download from "./download.js";
import * as gif from "./gif.js";
import * as remaster from "./remaster.js";
import * as stems from "./stems.js";
import * as transcribe from "./transcribe.js";

export { CancelledError, JobCtx } from "./base.js";

export const PIPELINES = {
  [OutputMode.VIDEO]: download.run,
  [OutputMode.AUDIO]: download.run,
  [OutputMode.CONVERT]: convert.run,
  [OutputMode.GIF]: gif.run,
  [OutputMode.CHAPTERS]: chapters.run,
  [OutputMode.REMASTER]: remaster.run,
  [OutputMode.TRANSCRIPT]: transcribe.run,
  [OutputMode.STEMS]: stems.run,
};
