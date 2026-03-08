import { parseEnvironment, zodPostgresUrl, zodRedisUrl } from '@spron/utils'
import z from 'zod'

const environmentType = z.object({
  BULLMQ_INPUT_QUEUE_NAME: z.string().default('enrichers-embedding'),
  BULLMQ_OUTPUT_QUEUE_NAMES: z.string().transform(string => string.split(',').map(name => name.trim()).filter(Boolean)),
  BULLMQ_REDIS_URL: zodRedisUrl(),

  DATABASE_URL: zodPostgresUrl(),

  EMBEDDOR_BASE_URL: z.url(),

  WORKER_BACKOFF_DELAY: z.string().default('10000').transform(Number),
  WORKER_CONCURRENCY: z.string().default('4').transform(Number),
  WORKER_MAX_ATTEMPTS: z.string().default('10').transform(Number)
})

export function getEnvironment () {
  return parseEnvironment(environmentType)
}
