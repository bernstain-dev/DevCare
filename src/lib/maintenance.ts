import { z } from 'zod'

export const maintenanceSchema = z.object({
  mode: z.enum(['off', 'announcement', 'maintenance']),
  title: z.string().trim().min(1).max(120),
  message: z.string().trim().min(1).max(1000),
})

export type MaintenanceConfig = z.infer<typeof maintenanceSchema>

export async function loadMaintenance(signal: AbortSignal): Promise<MaintenanceConfig> {
  const response = await fetch(`${import.meta.env.BASE_URL}maintenance.json`, {
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  })
  if (!response.ok) throw new Error('Unable to check portal availability.')
  return maintenanceSchema.parse(await response.json())
}
