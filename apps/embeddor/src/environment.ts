import { parseEnvironment } from '@spron/utils'
import z from 'zod'

const environmentType = z.object({
  OPENAI_API_KEY: z.string(),
  OPENAI_BASE_URL: z.string(),
  OPENAI_MODEL_NAME: z.string(),

  PORT: z.string().default('8000').transform(Number)
})

export function getEnvironment () {
  return parseEnvironment(environmentType)
}
