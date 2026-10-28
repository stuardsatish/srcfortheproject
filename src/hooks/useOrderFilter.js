import { useState, useMemo, useEffect } from "react"

/**
 * Filter + paginate a list of orders. Search is supplied externally (shared
 * across tabs); pagination state is owned per hook instance, so each tab keeps
 * its own page independently.
 *
 * @param {Array<Object>} orders        Orders for this tab.
 * @param {string} [search=""]          Shared search term (matches id / userName).
 * @param {number} [initialPageSize=10]
 * @returns {{
 *   filteredOrders: Object[],
 *   pagedOrders: Object[],
 *   total: number,
 *   page: number,
 *   setPage: (n:number)=>void,
 *   pageSize: number,
 *   setPageSize: (n:number)=>void,
 *   search: string
 * }}
 */
export default function useOrderFilter(orders, search = "", initialPageSize = 10) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(initialPageSize)

  const q = (search || "").trim().toLowerCase()

  const filteredOrders = useMemo(
    () =>
      (orders || []).filter(
        (o) =>
          !q ||
          o.id?.toLowerCase().includes(q) ||
          o.orderId?.toLowerCase().includes(q) ||
          o.userName?.toLowerCase().includes(q)
      ),
    [orders, q]
  )

  const total = filteredOrders.length
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  // Reset to page 1 whenever the search term or page size changes.
  useEffect(() => { setPage(1) }, [q, pageSize])
  // Clamp page if the data shrinks below the current page.
  useEffect(() => { if (page > totalPages) setPage(totalPages) }, [page, totalPages])

  const pagedOrders = useMemo(
    () => filteredOrders.slice((page - 1) * pageSize, page * pageSize),
    [filteredOrders, page, pageSize]
  )

  return { filteredOrders, pagedOrders, total, page, setPage, pageSize, setPageSize, search }
}