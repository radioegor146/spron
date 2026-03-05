import { parseEnvironment, zodPostgresUrl, zodRedisUrl } from '@spron/utils'
import z from 'zod'

const environmentType = z.object({
  BULLMQ_ENRICHERS_REDIS_URL: zodRedisUrl(),
  BULLMQ_INGRESS_REDIS_URL: zodRedisUrl(),
  BULLMQ_QUEUE_NAME: z.string().default('ingress'),

  DATABASE_URL: zodPostgresUrl(),

  IMAGE_ENRICHER_QUEUE_NAMES: z.string().transform(string => string.split(',').map(name => name.trim()).filter(Boolean)),
  POST_ENRICHER_QUEUE_NAMES: z.string().transform(string => string.split(',').map(name => name.trim()).filter(Boolean)),
  VIDEO_ENRICHER_QUEUE_NAMES: z.string().transform(string => string.split(',').map(name => name.trim()).filter(Boolean)),

  WORKER_BACKOFF_DELAY: z.string().default('10000').transform(Number),
  WORKER_CONCURRENCY: z.string().default('4').transform(Number),
  WORKER_MAX_ATTEMPTS: z.string().default('10').transform(Number)
})

export function getEnvironment () {
  return parseEnvironment(environmentType)
}
