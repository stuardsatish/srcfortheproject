// Wires the real Supabase client into the returns service. Import from here in screens:
//   import { returnsService } from "../../services/returns"
import { supabase } from "../../context/SupabaseConfig"
import { callFunction } from "../../utils/edgeFunctions"
import { createReturnsService } from "./returnsService.js"

export * from "./returnsService.js"
export const returnsService = createReturnsService(supabase, { callFunction })