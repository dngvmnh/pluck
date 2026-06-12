/** Pluck (Node) entrypoint — the equivalent of `python server.py`. */
import { createApp } from "./app.js";
import { startBackground } from "./jobs.js";

startBackground(true);

const app = createApp();
const port = parseInt(process.env.PORT || "8000", 10);
app.listen(port, "0.0.0.0", () => {
  console.log(`Pluck (Node) listening on http://localhost:${port}`);
});
