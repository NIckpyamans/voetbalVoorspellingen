import { sendSystemHealth } from "./_systemHealth.js";

export default function handler(req: any, res: any) {
  return sendSystemHealth(req, res, "health");
}
