// Wires the real Supabase client into the notifications service. Import from here in screens:
//   import { notificationsService } from "../../services/notifications"
import { supabase } from "../../context/SupabaseConfig"
import { createNotificationsService } from "./notificationsService.js"

export * from "./notificationsService.js"
export const notificationsService = createNotificationsService(supabase)