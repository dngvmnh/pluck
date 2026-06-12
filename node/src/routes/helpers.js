/** Express helpers shared by all routers: async wrapper + FastAPI-style errors. */
import { HttpError } from "../mythos.js";
import { ValidationError } from "../models.js";

/** Route async handlers through next() so the error middleware sees rejections. */
export function wrap(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** FastAPI-compatible error responses: {"detail": "..."} with the right status. */
export function errorMiddleware(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ detail: err.detail });
  }
  if (err instanceof ValidationError) {
    return res.status(422).json({ detail: err.message });
  }
  if (err.type === "entity.parse.failed") { // malformed JSON body (FastAPI gives 422)
    return res.status(422).json({ detail: "Invalid JSON body" });
  }
  console.error(err);
  return res.status(500).json({ detail: "Internal Server Error" });
}
