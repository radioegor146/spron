import { parseEnvironment, zodPostgresUrl, zodRedisUrl } from '@spron/utils'
import z from 'zod'

const environmentType = z.object({
  BULLMQ_ENRICHERS_REDIS_URL: zodRedisUrl(),
  BULLMQ_INGRESS_REDIS_URL: zodRedisUrl(),
  BULLMQ_QUEUE_NAME: z.string().default('ingress'),

  DATABASE_URL: zodPostgresUrl(),

  IMAGE_ENRICHER_QUEUE_NAMES: z.string().transform(string => string.split(',').map(name => name.trim()).filter(Boolean)),
  POST_ENRICHER_QUEUE_NAMES: z.string().transform(string => string.split(',').map(name => name.trim()).filter(Boolean)),
  VIDEO_ENRICHER_QUEUE_NAMES: z.string().transform(string => string.split(',').map(name => name.trim()).filter(Boolean))
})

export function getEnvironment () {
  return parseEnvironment(environmentType)
}
