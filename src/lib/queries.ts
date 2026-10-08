import { useQuery } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Client, Project } from './types'
export async function allRows<T>(table: string, order = 'name'): Promise<T[]> {
  const rows: T[] = []
  for (let offset = 0; ; offset += 200) {
    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order(order)
      .range(offset, offset + 199)
    if (error) throw error
    rows.push(...(data as T[]))
    if (data.length < 200) return rows
  }
}
export function useProjects() {
  return useQuery({ queryKey: ['project-options'], queryFn: () => allRows<Project>('projects') })
}
export function useClients() {
  return useQuery({ queryKey: ['client-options'], queryFn: () => allRows<Client>('clients') })
}
