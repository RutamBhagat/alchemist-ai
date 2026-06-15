import { z } from "zod";
import type {
  ContextSnapshotMessage,
  ErrorMessage,
  PingMessage,
  ServerMessage,
  StreamEndMessage,
  TokenMessage,
  ToolCallMessage,
  ToolResultMessage,
} from "../../../agent-server/src/types";

const recordSchema: z.ZodType<Record<string, unknown>> = z.record(z.string(), z.unknown());

const tokenSchema = z.object({
  type: z.literal("TOKEN"),
  seq: z.number(),
  text: z.string(),
  stream_id: z.string(),
}) satisfies z.ZodType<TokenMessage>;

const toolCallSchema = z.object({
  type: z.literal("TOOL_CALL"),
  seq: z.number(),
  call_id: z.string(),
  tool_name: z.string(),
  args: recordSchema,
  stream_id: z.string(),
}) satisfies z.ZodType<ToolCallMessage>;

const toolResultSchema = z.object({
  type: z.literal("TOOL_RESULT"),
  seq: z.number(),
  call_id: z.string(),
  result: recordSchema,
  stream_id: z.string(),
}) satisfies z.ZodType<ToolResultMessage>;

const contextSchema = z.object({
  type: z.literal("CONTEXT_SNAPSHOT"),
  seq: z.number(),
  context_id: z.string(),
  data: recordSchema,
}) satisfies z.ZodType<ContextSnapshotMessage>;

const pingSchema = z.object({
  type: z.literal("PING"),
  seq: z.number(),
  challenge: z.string(),
}) satisfies z.ZodType<PingMessage>;

const streamEndSchema = z.object({
  type: z.literal("STREAM_END"),
  seq: z.number(),
  stream_id: z.string(),
}) satisfies z.ZodType<StreamEndMessage>;

const errorSchema = z.object({
  type: z.literal("ERROR"),
  seq: z.number(),
  code: z.string(),
  message: z.string(),
}) satisfies z.ZodType<ErrorMessage>;

export const serverMessageSchema: z.ZodType<ServerMessage> = z.discriminatedUnion("type", [
  tokenSchema,
  toolCallSchema,
  toolResultSchema,
  contextSchema,
  pingSchema,
  streamEndSchema,
  errorSchema,
]);
