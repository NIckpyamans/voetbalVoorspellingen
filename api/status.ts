import { sendSystemHealth } from "./systemHealth";

export default function handler(req: any, res: any) {
  return sendSystemHealth(req, res, "status");
}
