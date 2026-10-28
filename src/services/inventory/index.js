// Wires the real Supabase client into the inventory / order-lifecycle admin service. Import from here in screens:
//   import { inventoryService } from "../../services/inventory"
import { supabase } from "../../context/SupabaseConfig"
import { createInventoryService } from "./inventoryService.js"

export * from "./inventoryService.js"
export const inventoryService = createInventoryService(supabase)