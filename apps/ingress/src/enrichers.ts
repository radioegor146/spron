import { ConnectionOptions, Queue } from 'bullmq'

export type EnricherQueue = Queue<string>

export function createEnricherQueues (names: string[], connection: ConnectionOptions): EnricherQueue[] {
  return names.map(name => new Queue<string>(name, {
    connection
  }))
}
