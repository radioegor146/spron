import { parseEnvironment, zodPostgresUrl, zodRedisUrl } from '@spron/utils'
import z from 'zod'

const environmentType = z.object({
  BULLMQ_INPUT_QUEUE_NAME: z.string().default('enrichers-description'),
  BULLMQ_OUTPUT_QUEUE_NAMES: z.string().transform(string => string.split(',').map(name => name.trim()).filter(Boolean)),
  BULLMQ_REDIS_URL: zodRedisUrl(),

  DATABASE_URL: zodPostgresUrl(),

  OPENAI_API_KEY: z.string(),
  OPENAI_BASE_URL: z.string(),
  OPENAI_MODEL_NAME: z.string(),

  PROMPT_IMAGE_DESCRIPTION: z.string(),
  PROMPT_VIDEO_DESCRIPTION: z.string(),

  S3_STORAGE_ACCESS_KEY: z.string(),
  S3_STORAGE_ENDPOINT: z.url(),
  S3_STORAGE_REGION: z.string().default('us-east-1'),
  S3_STORAGE_SECRET_KEY: z.string(),

  VIDEO_DESCRIPTION_MAX_FRAMES: z.string().default('20').transform(Number),
  VIDEO_DESCRIPTION_MIN_INTERVAL: z.string().default('2').transform(Number),

  WORKER_BACKOFF_DELAY: z.string().default('10000').transform(Number),
  WORKER_CONCURRENCY: z.string().default('4').transform(Number),
  WORKER_MAX_ATTEMPTS: z.string().default('10').transform(Number)
})

export function getEnvironment () {
  return parseEnvironment(environmentType)
}
