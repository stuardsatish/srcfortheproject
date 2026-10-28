// Wires the real Supabase client into the shipping service. Import from here in screens:
//   import { shippingService, queryOrdersWithShipments } from "../../services/shipping"
import { supabase } from "../../context/SupabaseConfig"
import { createShippingService } from "./shippingService.js"

export * from "./shippingService.js"
export * from "./couriers.js"
export { newEventKey } from "./manualCourier.js"
export const shippingService = createShippingService(supabase)