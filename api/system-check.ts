import { sendSystemHealth } from "./systemHealth.js";

export default function handler(req: any, res: any) {
  return sendSystemHealth(req, res, "system-check");
}
