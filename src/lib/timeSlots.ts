import { z } from "zod";
import type { TimeSlot } from "./types";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const timeSlotsSchema = z.array(z.object({ start: time, end: time, task: z.enum(["main", "kaizen"]) }))
  .min(1)
  .max(24)
  .refine((slots) => slots.every((slot) => slot.start < slot.end), "End must be after start")
  .refine((slots) => {
    const sorted = [...slots].sort((first, second) => first.start.localeCompare(second.start));
    return sorted.every((slot, index) => index === 0 || sorted[index - 1].end <= slot.start);
  }, "Time slots must not overlap");

const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
export const slotHours = (slots: TimeSlot[]) => slots.reduce((total, slot) => total + Math.max(0, minutes(slot.end) - minutes(slot.start)), 0) / 60;