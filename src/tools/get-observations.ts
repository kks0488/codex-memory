import { z } from "zod";
import { getObservationsByIds } from "../db.js";

export const getObservationsShape = {
  ids: z.array(z.number().int()).min(1).max(50).describe("Observation IDs to fetch"),
} as const;

export type GetObservationsInput = z.infer<z.ZodObject<typeof getObservationsShape>>;

function safeParse(json: string | null): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return json;
  }
}

export function handleGetObservations(input: GetObservationsInput) {
  const raw = getObservationsByIds(input.ids);
  const items = raw.map((obs) => ({
    ...obs,
    meta_json: safeParse(obs.meta_json),
  }));

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ items, count: items.length }, null, 2),
      },
    ],
  };
}
